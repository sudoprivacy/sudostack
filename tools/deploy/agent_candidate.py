#!/usr/bin/env python3
"""Prepare and build local Agent candidates from exact owner source archives.

This is a pre-release artifact assembler. It does not publish, initialize a
production database, install the Cloud suite, or qualify a desktop signature.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

from artifacts import asset_path, checksum
from release import save_image, verify_image_archive

OWNERS = {'moss': 'sudoprivacy/moss', 'work': 'sudoprivacy/sudowork', 'nexus': 'nexi-lab/nexus'}
COMPONENTS = {
    'moss': ('moss', 'deploy/server.Dockerfile.local', 'control-server-image'),
    'nexus-runtime': ('moss', 'deploy/server.Dockerfile.local', 'nexus-image'),
    'webui': ('work', 'apps/webui/Dockerfile', None),
    'http-provider': ('moss', 'deploy/http-agent-provider/Dockerfile', None),
    'product-registry': ('nexus', 'Dockerfile', None),
}
ASSEMBLER_FILES = ('agent_candidate.py', 'artifacts.py', 'release.py')


def assembler_files():
    return {name: checksum(Path(__file__).resolve().parent / name) for name in ASSEMBLER_FILES}

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def full_revision(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{40}', value):
        raise ValueError('A full source revision is required')
    return value


def json_write(path, value):
    temporary = path.with_name(path.name + '.part')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def export_source(repo, revision, output):
    """Include committed files/submodules and verified LFS objects, never scratch files."""
    full_revision(revision)
    with tarfile.open(output, 'w') as target:
        def append(checkout, pin, prefix=''):
            # Git otherwise searches parent directories for an uninitialized
            # submodule and attempts to archive its pin from the wrong repository.
            root = subprocess.run(['git', '-C', str(checkout), 'rev-parse', '--show-toplevel'],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if root.returncode or Path(root.stdout.strip()).resolve() != checkout.resolve():
                raise ValueError(f'Initialize pinned submodule checkout: {checkout} at {pin}')
            tree = subprocess.run(['git', '-C', str(checkout), 'cat-file', '-e', pin + '^{tree}'],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if tree.returncode:
                raise ValueError(f'Missing pinned source tree: {checkout} at {pin}')
            proc = subprocess.Popen(['git', '-C', str(checkout), 'archive', '--format=tar', pin], stdout=subprocess.PIPE)
            try:
                with tarfile.open(fileobj=proc.stdout, mode='r|') as source:
                    for entry in source:
                        member = copy.copy(entry)
                        member.name = prefix + entry.name
                        if member.isfile():
                            stream = source.extractfile(entry)
                            # LFS pointers are small. Only replace an exact committed object.
                            if member.size < 1024:
                                raw = stream.read()
                                match = re.fullmatch(rb'version https://git-lfs.github.com/spec/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n', raw)
                                if match:
                                    local = asset_path(checkout, entry.name)
                                    if not local.is_file() or local.stat().st_size != int(match[2]) or checksum(local) != match[1].decode():
                                        raise ValueError('Missing or changed committed LFS object: ' + member.name)
                                    member.size = local.stat().st_size
                                    with local.open('rb') as content:
                                        target.addfile(member, content)
                                    continue
                                import io
                                stream = io.BytesIO(raw)
                            target.addfile(member, stream)
                        else:
                            target.addfile(member)
                if proc.wait():
                    raise ValueError('git archive failed')
            finally:
                proc.stdout.close()
                if proc.poll() is None:
                    proc.terminate()
                    proc.wait()
            for row in git(checkout, 'ls-tree', '-rz', pin).split(b'\0'):
                if not row:
                    continue
                metadata, path = row.split(b'\t', 1)
                mode, kind, object_id = metadata.split()
                if mode == b'160000' and kind == b'commit':
                    name = path.decode()
                    submodule = asset_path(checkout, name)
                    append(submodule, full_revision(object_id.decode()), prefix + name + '/')
        append(repo, revision)


def prepare(repos, provider, output, architecture):
    if architecture not in ('amd64', 'arm64'):
        raise ValueError('Unsupported architecture')
    if output.exists():
        raise ValueError('Use a new candidate directory')
    # Run the actual consumers' exact-source validators before exporting.
    stack = Path(__file__).resolve().parents[2]
    if git(stack, 'status', '--porcelain', '--untracked-files=no').strip() or git(stack, 'show', 'HEAD:tools/deploy/agent_candidate.py') != Path(__file__).read_bytes():
        raise ValueError('Commit the assembler before recording its source revision')
    for script in ('check-external-contract.mjs', 'check-task-contract.mjs'):
        subprocess.run(['node', str(repos['work'] / 'scripts' / script), '--stack', str(stack)], check=True)
    subprocess.run(['node', str(repos['moss'] / 'scripts/contracts/registry-source.mjs'), '--stack', str(stack), '--owner', str(repos['nexus'])], check=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='agent-candidate-', dir=output.parent) as temporary:
        stage = Path(temporary)
        sources = {}
        for name, repo in repos.items():
            origin = git(repo, 'remote', 'get-url', 'origin').decode().strip().replace('git@github.com:', 'https://github.com/').removesuffix('.git')
            if origin != 'https://github.com/' + OWNERS[name]:
                raise ValueError('Unexpected source owner: ' + name)
            if git(repo, 'status', '--porcelain', '--untracked-files=no').strip():
                raise ValueError('Commit tracked source changes first: ' + name)
            revision = full_revision(git(repo, 'rev-parse', 'HEAD').decode().strip())
            archive = stage / (name + '-source.tar')
            export_source(repo, revision, archive)
            sources[name] = {'repository': origin, 'revision': revision, 'archive': archive.name, 'sha256': checksum(archive)}
        subprocess.run(['node', str(repos['moss'] / 'scripts/http-agent-artifact.mjs'), '--directory', str(provider), '--revision', sources['moss']['revision']], check=True)
        files = {}
        for name in ('http-agent-provider.mjs', 'artifact-manifest.json'):
            shutil.copyfile(provider / name, stage / name)
            files[name] = checksum(stage / name)
        lock = {'schema_version': 1, 'kind': 'LocalAgentCandidate', 'architecture': architecture,
                'assembler_revision': full_revision(git(stack, 'rev-parse', 'HEAD').decode().strip()),
                'assembler_files': assembler_files(),
                'sources': sources, 'provider_files': files,
                'qualification': 'unqualified; build and deployment evidence required'}
        json_write(stage / 'candidate.lock.json', lock)
        stage.rename(output)
    return lock


def load_lock(directory):
    lock = json.loads((directory / 'candidate.lock.json').read_text())
    if (lock.get('schema_version') != 1 or lock.get('kind') != 'LocalAgentCandidate'
            or lock.get('architecture') not in ('amd64', 'arm64') or set(lock.get('sources', {})) != set(OWNERS)
            or set(lock.get('provider_files', {})) != {'http-agent-provider.mjs', 'artifact-manifest.json'}):
        raise ValueError('Invalid local candidate lock')
    full_revision(lock.get('assembler_revision'))
    if lock.get('assembler_files') != assembler_files():
        raise ValueError('Use the exact assembler files recorded by candidate preparation')
    for name, source in lock['sources'].items():
        full_revision(source['revision'])
        if source['repository'] != 'https://github.com/' + OWNERS[name] or source['archive'] != name + '-source.tar':
            raise ValueError('Invalid source identity')
        if checksum(asset_path(directory, source['archive'])) != source['sha256']:
            raise ValueError('Changed source archive: ' + name)
    for name, digest in lock['provider_files'].items():
        if checksum(asset_path(directory, name)) != digest:
            raise ValueError('Changed Provider artifact')
    return lock


def inspect_archive(path, reference, architecture, image_id):
    verify_image_archive(path, [reference], architecture)
    with tarfile.open(path) as archive:
        entries = json.load(archive.extractfile('manifest.json'))
        if len(entries) != 1 or entries[0].get('RepoTags') != [reference]:
            raise ValueError('Candidate archive must contain exactly its selected image')
        config = archive.extractfile(entries[0]['Config']).read()
        if 'sha256:' + hashlib.sha256(config).hexdigest() != image_id:
            raise ValueError('Image config digest mismatch')
        diff_ids = json.loads(config).get('rootfs', {}).get('diff_ids', [])
        layers = entries[0]['Layers']
        if len(layers) != len(diff_ids) or not layers:
            raise ValueError('Image layer list differs from config')
        for layer, expected in zip(layers, diff_ids):
            if not archive.getmember(layer).isfile():
                raise ValueError('Missing image layer')
            digest = hashlib.sha256()
            with archive.extractfile(layer) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            if 'sha256:' + digest.hexdigest() != expected:
                raise ValueError('Image layer digest mismatch')


def build(directory, component):
    lock = load_lock(directory)
    (directory / 'candidate-images.json').unlink(missing_ok=True)
    (directory / (component + '-image.json')).unlink(missing_ok=True)
    owner, dockerfile, target = COMPONENTS[component]
    source = lock['sources'][owner]
    lock_digest = checksum(directory / 'candidate.lock.json')
    reference = f'sudo-agent-candidate/{component}:{lock_digest[:16]}-{lock["architecture"]}'
    with tempfile.TemporaryDirectory(prefix='agent-candidate-build-') as temporary:
        context = Path(temporary)
        with tarfile.open(directory / source['archive']) as archive:
            archive.extractall(context, filter='data')
        if component == 'http-provider':
            dest = context / 'dist/http-agent-provider'
            dest.mkdir(parents=True)
            for name in lock['provider_files']:
                shutil.copyfile(directory / name, dest / name)
        command = ['docker', 'buildx', 'build', '--platform', 'linux/' + lock['architecture'], '--load', '--progress', 'plain',
                   '--label', 'org.opencontainers.image.revision=' + source['revision'],
                   '--label', 'org.opencontainers.image.source=' + source['repository'],
                   '--build-arg', 'SOURCE_REVISION=' + source['revision'], '-t', reference, '-f', str(context / dockerfile)]
        if target:
            command.extend(['--target', target])
        with (directory / (component + '-build.log')).open('w') as log:
            subprocess.run([*command, str(context)], stdout=log, stderr=subprocess.STDOUT, check=True)
    info = json.loads(subprocess.check_output(['docker', 'image', 'inspect', reference], text=True))[0]
    if info['Os'] != 'linux' or info['Architecture'] != lock['architecture'] or info['Config']['Labels']['org.opencontainers.image.revision'] != source['revision']:
        raise ValueError('Built image does not match candidate')
    archive = directory / (component + '-image.tar.gz')
    # The tag supplies the archive name; inspect_archive verifies immutable config bytes.
    save_image(reference, archive)
    inspect_archive(archive, reference, lock['architecture'], info['Id'])
    record = {'component': component, 'candidate_lock_sha256': lock_digest, 'source_revision': source['revision'],
              'image': reference, 'image_config_digest': info['Id'], 'architecture': lock['architecture'],
              'archive': archive.name, 'sha256': checksum(archive)}
    json_write(directory / (component + '-image.json'), record)
    return record


def assemble(directory):
    (directory / 'candidate-images.json').unlink(missing_ok=True)
    lock = load_lock(directory)
    lock_digest = checksum(directory / 'candidate.lock.json')
    records = {}
    for component, (owner, _, _) in COMPONENTS.items():
        record = json.loads((directory / (component + '-image.json')).read_text())
        if (record.get('component') != component or record.get('candidate_lock_sha256') != lock_digest
                or record.get('source_revision') != lock['sources'][owner]['revision'] or record.get('architecture') != lock['architecture']
                or record.get('archive') != component + '-image.tar.gz'):
            raise ValueError('Stale or foreign component record: ' + component)
        archive = asset_path(directory, record['archive'])
        if checksum(archive) != record['sha256']:
            raise ValueError('Changed image archive: ' + component)
        inspect_archive(archive, record['image'], lock['architecture'], record['image_config_digest'])
        records[component] = record
    manifest = {'kind': 'LocalAgentCandidateImages', 'schema_version': 1, 'candidate_lock_sha256': lock_digest,
                'images': records, 'qualification': 'images assembled; deployment, migration, desktop signing and business acceptance still required'}
    json_write(directory / 'candidate-images.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_parser = commands.add_parser('prepare')
    for owner in OWNERS:
        prepare_parser.add_argument('--' + owner, required=True, type=Path)
    prepare_parser.add_argument('--provider', required=True, type=Path)
    prepare_parser.add_argument('--output', required=True, type=Path)
    prepare_parser.add_argument('--architecture', choices=['arm64', 'amd64'], required=True)
    for verb in ('build', 'assemble'):
        sub = commands.add_parser(verb)
        sub.add_argument('--directory', required=True, type=Path)
        if verb == 'build':
            sub.add_argument('--component', choices=COMPONENTS, required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare({name: getattr(args, name).resolve() for name in OWNERS}, args.provider.resolve(), args.output.resolve(), args.architecture)
    elif args.command == 'build':
        build(args.directory.resolve(), args.component)
    else:
        assemble(args.directory.resolve())
    print(args.command + ' completed; no release was published or deployed')


if __name__ == '__main__':
    main()
