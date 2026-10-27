"""Exercise archive identity, CRI pinning and restart recovery on a real owned K3s node."""
import argparse
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import uuid

from artifacts import checksum
from images import archive_images, inspect_image, retain_archive

K3S_IMAGE = 'rancher/k3s@sha256:5e0707cfd1239b358ef73f3254bc3eadc027dd30cd5ec6ca41e29e47652a1b8c'


def fixture_archive(path, tag, variant):
    """Create a tiny real OCI image with Docker-compatible archive metadata."""
    config = json.dumps({'architecture': 'amd64', 'os': 'linux', 'rootfs': {'type': 'layers', 'diff_ids': []},
                         'config': {}, 'history': []}).encode()
    config_id = hashlib.sha256(config).hexdigest()
    manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
        'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': 'sha256:' + config_id,
                   'size': len(config)}, 'layers': [], 'annotations': {'fixture': variant}}).encode()
    manifest_id = hashlib.sha256(manifest).hexdigest()
    metadata = {'oci-layout': b'{"imageLayoutVersion":"1.0.0"}',
        'manifest.json': json.dumps([{'Config': 'blobs/sha256/' + config_id, 'RepoTags': [tag], 'Layers': []}]).encode(),
        'index.json': json.dumps({'schemaVersion': 2, 'manifests': [{
            'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'digest': 'sha256:' + manifest_id,
            'size': len(manifest), 'annotations': {'io.containerd.image.name': tag}}]}).encode(),
        'blobs/sha256/' + config_id: config, 'blobs/sha256/' + manifest_id: manifest}
    with tarfile.open(path, 'w:gz') as archive:
        for name, raw in metadata.items():
            member = tarfile.TarInfo(name)
            member.size = len(raw)
            archive.addfile(member, io.BytesIO(raw))
    return archive_images(path)[tag]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True, type=Path)
    args = parser.parse_args()
    root = args.evidence.resolve()
    root.mkdir(parents=True, exist_ok=False)
    retained, inputs, bridge = root / 'retained', root / 'inputs', root / 'bin'
    for directory in [retained, inputs, bridge]:
        directory.mkdir()
    label = 'moss-image-e2e-' + uuid.uuid4().hex
    tag = 'docker.io/library/' + label + ':1'
    archive = inputs / 'image.tar.gz'
    identity = fixture_archive(archive, tag, 'accepted')
    reference = tag.rsplit(':', 1)[0] + '@' + identity['manifestDigest']
    name = 'codex-owned-' + label
    node = None
    original_path = os.environ.get('PATH', '')
    proof = {'success': False, 'realKubernetes': True, 'image': identity, 'reference': reference, 'phases': []}

    def execute(*arguments, timeout=60):
        result = subprocess.run(arguments, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        if result.returncode:
            raise RuntimeError('Command failed: ' + repr(arguments) + '\n' + result.stderr)
        return result.stdout

    def owned():
        info = json.loads(execute('docker', 'inspect', node))[0]
        assert info['Id'] == node and info['Config']['Labels']['com.sudoprivacy.acceptance'] == label
        return info

    def wait_identity():
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            status = inspect_image(tag)
            if status is not None and status.get('pinned') is True and reference in status.get('repoDigests', []):
                assert status['id'] == identity['id']
                return {key: status[key] for key in ['id', 'pinned', 'repoDigests']}
            time.sleep(1)
        raise TimeoutError('The retained image must recover its exact manifest and CRI pin after restart')

    def ready_generation(timeout):
        """Observe a heartbeat from this kubelet incarnation before trusting cached images."""
        started = datetime.datetime.fromisoformat(owned()['State']['StartedAt'].replace('Z', '+00:00'))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            lease = subprocess.run(['docker', 'exec', node, '/bin/kubectl', '-n', 'kube-node-lease',
                'get', 'lease', name, '--ignore-not-found', '-o', 'json'], capture_output=True, text=True, timeout=15)
            if lease.returncode == 0 and lease.stdout.strip():
                renewed = json.loads(lease.stdout)['spec']['renewTime']
                if datetime.datetime.fromisoformat(renewed.replace('Z', '+00:00')) >= started:
                    return {'startedAt': started.isoformat(), 'renewTime': renewed}
            assert owned()['State']['Running']
            time.sleep(1)
        raise TimeoutError('The current kubelet must publish a fresh heartbeat')

    try:
        node = execute('docker', 'run', '-d', '--name', name, '--hostname', name,
            '--label', 'com.sudoprivacy.acceptance=' + label, '--privileged', '--cpus', '2', '--memory', '2g',
            '--memory-swap', '2g', '--tmpfs', '/run', '--tmpfs', '/var/run',
            '--mount', 'type=bind,source=' + retained.as_posix() + ',target=/var/lib/rancher/k3s/agent/images',
            K3S_IMAGE, 'server', '--disable', 'traefik', '--disable', 'servicelb', '--disable', 'metrics-server',
            '--disable', 'coredns', '--disable', 'local-storage', timeout=180).strip()
        assert len(node) == 64
        owned()
        wrapper = bridge / 'k3s'
        wrapper.write_text('#!/bin/sh\nset -eu\ntool="$1"\nshift\ncase "$tool" in\n'
            'crictl) exec docker exec ' + node + ' /bin/crictl --runtime-endpoint unix:///run/k3s/containerd/containerd.sock "$@" ;;\n'
            'ctr) exec docker exec ' + node + ' /bin/ctr --address /run/k3s/containerd/containerd.sock "$@" ;;\n'
            '*) exit 64 ;;\nesac\n', encoding='utf-8')
        wrapper.chmod(0o700)
        os.environ['PATH'] = str(bridge) + os.pathsep + original_path
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            ready = subprocess.run(['docker', 'exec', node, '/bin/kubectl', 'get', 'nodes', '-o', 'json'],
                                   capture_output=True, text=True, encoding='utf-8', timeout=15)
            if ready.returncode == 0 and any(condition['type'] == 'Ready' and condition['status'] == 'True'
                for item in json.loads(ready.stdout)['items'] for condition in item['status'].get('conditions', [])):
                break
            assert owned()['State']['Running']
            time.sleep(1)
        else:
            raise TimeoutError('The owned Kubernetes node must become Ready')
        result = retain_archive(archive, checksum(archive), directory=retained, timeout=120)
        assert result['images'][tag] == wait_identity()
        proof['phases'].append({'imported': result})
        execute('docker', 'restart', node, timeout=90)
        ready = ready_generation(60)
        proof['phases'].append({'restart': wait_identity(), 'ready': ready})
        target = Path(result['archive'])
        before = target.stat().st_mtime_ns
        assert retain_archive(archive, checksum(archive), directory=retained) == result
        assert target.stat().st_mtime_ns == before
        execute('k3s', 'crictl', 'rmi', '--prune')
        proof['phases'].append({'afterPrune': wait_identity()})
        conflict = inputs / 'conflict.tar.gz'
        other = fixture_archive(conflict, tag, 'conflicting')
        assert other['id'] == identity['id'] and other['manifestDigest'] != identity['manifestDigest']
        try:
            retain_archive(conflict, checksum(conflict), directory=retained)
        except ValueError as error:
            assert 'manifest mismatch' in str(error)
        else:
            raise AssertionError('A different manifest sharing the config must be refused')
        assert not (retained / (checksum(conflict) + '.tar.gz')).exists()
        proof['phases'].append({'conflictRefused': True, 'acceptedImagePreserved': wait_identity()})
        proof['success'] = True
    finally:
        os.environ['PATH'] = original_path
        if node is not None:
            owned()
            execute('docker', 'stop', node, timeout=60)
            proof['ownedNodeStopped'] = not owned()['State']['Running']
        (root / 'receipt.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
