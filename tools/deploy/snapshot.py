#!/usr/bin/env python3
"""Authenticated encrypted cold snapshots for the single-node Atlas profile."""
import argparse
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
from types import SimpleNamespace

os.umask(0o077)
parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['backup','restore'])
parser.add_argument('--root',type=Path,default=Path('/data/atlas'))
parser.add_argument('--backup',type=Path)
parser.add_argument('--key-file',type=Path,required=True)
args=parser.parse_args()
root=args.root.resolve()
key=args.key_file.resolve()
if not key.is_file() or len(key.read_bytes())<32:
    raise SystemExit('Provide a private backup key file of at least 32 bytes; keep it separately from backups')
if key.is_relative_to(root):
    raise SystemExit('Backup key must be stored outside the installation and backup directories')
if key.stat().st_mode & 0o077:
    raise SystemExit('Backup key permissions must be 600')
spec=importlib.util.spec_from_file_location('atlas',Path(__file__).with_name('atlas.py'))
atlas=importlib.util.module_from_spec(spec);spec.loader.exec_module(atlas)
backup=(args.backup or Path('/var/backups/atlas')/time.strftime('%Y%m%d-%H%M%S')).resolve()
if backup.is_relative_to(root) or key.is_relative_to(backup):
    raise SystemExit('Backup and key must be outside the installation, and key outside backup')

def authenticated(path):
    mac=hmac.new(key.read_bytes(),digestmod=hashlib.sha256)
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):mac.update(block)
    return mac.hexdigest()

def volumes():
    result=[]
    for namespace in (atlas.NAMESPACE,'moss-sessions'):
        for claim in json.loads(atlas.kube('-n',namespace,'get','pvc','-o','json'))['items']:
            pv=json.loads(atlas.kube('get','pv',claim['spec']['volumeName'],'-o','json'))
            path=pv['spec'].get('hostPath',pv['spec'].get('local',{})).get('path')
            if not path or not Path(path).is_dir():raise RuntimeError('Local bound PVC required')
            result.append({'namespace':namespace,'claim':claim['metadata']['name'],'uid':claim['metadata']['uid'],'path':path})
    return result

def assert_quiet():
    pods=json.loads(atlas.kube('-n','moss-sessions','get','pods','-o','json'))['items']
    if any(p.get('status',{}).get('phase') not in ('Succeeded','Failed') for p in pods):
        raise RuntimeError('Active runtime Pods remain; finish sessions before taking a cold snapshot')

with tempfile.TemporaryDirectory(prefix='atlas-snapshot-') as tmp:
    temp=Path(tmp)
    if args.action=='backup':
        if backup.exists():raise SystemExit('Backup destination already exists')
        backup.mkdir(parents=True,mode=0o700)
        atlas.manage(SimpleNamespace(root=root,action='stop'))
        try:
            assert_quiet()
            manifest={'root':str(root),'volumes':volumes(),'release':json.loads((root/'release-manifest.json').read_text())['release']}
            atlas.write(temp/'snapshot.json',manifest)
            secrets=json.loads(atlas.kube('-n',atlas.NAMESPACE,'get','secrets','-o','json'))
            secrets['items']=[s for s in secrets['items'] if s['type']!='helm.sh/release.v1']
            for item in secrets['items']:
                item['metadata']={k:v for k,v in item['metadata'].items() if k in ('name','namespace','labels','annotations')}
                item['metadata'].get('annotations',{}).pop('kubectl.kubernetes.io/last-applied-configuration',None)
            atlas.write(temp/'secrets.json',secrets)
            with tarfile.open(temp/'snapshot.tar','w') as archive:
                archive.add(temp/'snapshot.json',arcname='snapshot.json')
                archive.add(temp/'secrets.json',arcname='secrets.json')
                archive.add(root,arcname='installation')
                for i,v in enumerate(manifest['volumes']):archive.add(v['path'],arcname='volumes/'+str(i))
            subprocess.run(['openssl','enc','-aes-256-cbc','-pbkdf2','-iter','200000','-salt','-pass','file:'+str(key),'-in',str(temp/'snapshot.tar'),'-out',str(backup/'snapshot.enc')],check=True)
            (backup/'snapshot.hmac').write_text(authenticated(backup/'snapshot.enc')+'\n')
        finally:
            atlas.manage(SimpleNamespace(root=root,action='start'))
        print('Encrypted cold snapshot: '+str(backup))
    else:
        if not hmac.compare_digest(authenticated(backup/'snapshot.enc'),(backup/'snapshot.hmac').read_text().strip()):
            raise SystemExit('Snapshot authentication failed; no services changed')
        subprocess.run(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-pass','file:'+str(key),'-in',str(backup/'snapshot.enc'),'-out',str(temp/'snapshot.tar')],check=True)
        unpack=temp/'unpack';unpack.mkdir()
        with tarfile.open(temp/'snapshot.tar') as archive:
            # Inspect all paths before extracting anything, including link targets.
            for member in archive.getmembers():
                target=(unpack/member.name).resolve()
                if not target.is_relative_to(unpack) or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                    raise ValueError('Unsafe snapshot archive member')
                if member.issym() and not (target.parent/member.linkname).resolve().is_relative_to(unpack):raise ValueError('Unsafe snapshot symlink')
                if member.islnk() and not (unpack/member.linkname).resolve().is_relative_to(unpack):raise ValueError('Unsafe snapshot hardlink')
            archive.extractall(unpack)
        saved=json.loads((unpack/'snapshot.json').read_text())
        current=volumes()
        if saved['root']!=str(root) or saved['volumes']!=current:
            raise SystemExit('This restore command requires the original node/PVC identities')
        atlas.manage(SimpleNamespace(root=root,action='stop'))
        # Do not restart after a partial restore: the operator must resolve that failure first.
        assert_quiet()
        for i,v in enumerate(current):
            target=Path(v['path'])
            for child in target.iterdir():
                if child.is_dir() and not child.is_symlink():shutil.rmtree(child)
                else:child.unlink()
            shutil.copytree(unpack/'volumes'/str(i),target,dirs_exist_ok=True,symlinks=True)
        shutil.copytree(unpack/'installation',root,dirs_exist_ok=True,symlinks=True)
        atlas.apply(json.loads((unpack/'secrets.json').read_text()))
        atlas.manage(SimpleNamespace(root=root,action='start'))
        print('Cold snapshot restored and HTTPS health verified')
