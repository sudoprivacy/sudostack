#!/usr/bin/env python3
"""Assemble one versioned sudostack release from its owners' CI releases."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import quote

from artifacts import checksum, download

HERE = Path(__file__).resolve().parent
COMPONENTS = {'moss', 'webui', 'nexus', 'vault', 'sudocode', 'k3s', 'gvisor', 'helm', 'caddy', 'postgres', 'nexusBase'}
ARCHITECTURES = {'amd64': ('x86_64', 'x64', 'k3s'), 'arm64': ('aarch64', 'arm64', 'k3s-arm64')}


def read_lock(path):
    lock = json.loads(path.read_text())
    if lock.get('schemaVersion') not in (1, 2) or lock.get('architecture') not in ARCHITECTURES:
        raise ValueError('Only deployment lock schemas 1 and 2 / amd64 or arm64 are supported')
    if lock.get('repository') != 'sudoprivacy/sudostack':
        raise ValueError('This installer is published by sudoprivacy/sudostack')
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', lock['version']):
        raise ValueError('Invalid sudostack version')
    required = COMPONENTS | ({'router'} if lock['schemaVersion'] == 2 else set())
    if set(lock['components']) != required:
        raise ValueError('The deployment lock must specify every component')
    expected_owners = {'moss': 'sudoprivacy/moss', 'webui': 'sudoprivacy/sudowork',
                       'nexus': 'nexi-lab/nexus-vfs', 'vault': 'nexi-lab/nexus', 'sudocode': 'sudoprivacy/sudocode',
                       'router': 'sudoprivacy/new-api'}
    prefixes = {'moss': 'server-v', 'webui': 'v', 'nexus': 'v', 'vault': 'vault-v', 'sudocode': 'v', 'router': 'sudorouter-v'}
    for name, component in lock['components'].items():
        version = component['version']
        if not re.fullmatch(r'(?:v|release-)?\d[0-9A-Za-z.+-]*', version):
            raise ValueError('A fixed component version is required: ' + name)
        if name in expected_owners and (component.get('repository') != expected_owners[name]
                                       or component.get('tag') != prefixes[name] + version):
            raise ValueError('Component repository/tag does not match its locked version: ' + name)
        if 'image' in component and not re.fullmatch(r'docker\.io/library/[a-z0-9-]+:\d[^\s/@]*', component['image']):
            raise ValueError('Official images need explicit version tags: ' + name)
        if 'image' in component and not component['image'].split(':')[-1].split('-')[0] == version:
            raise ValueError('Image tag differs from its component version: ' + name)
    if 'baseRelease' in lock:
        base = lock['baseRelease']
        if (lock['schemaVersion'] != 2 or base.get('repository') != lock['repository']
            or not re.fullmatch(r'sudostack-v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', base.get('tag', ''))
            or not re.fullmatch(r'[a-f0-9]{64}', base.get('manifestSha256', ''))):
            raise ValueError('A fixed, checksummed sudostack base release is required')
    return lock


def github(endpoint):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def release_assets(repository, tag, names):
    release = github(f'repos/{repository}/releases/tags/{quote(tag, safe="")}')
    if release.get('draft') or release['tag_name'] != tag:
        raise ValueError('A published, exact-tag release is required: ' + repository + '@' + tag)
    assets = {asset['name']: asset for asset in release['assets']}
    missing = sorted(set(names) - assets.keys())
    if missing:
        raise ValueError(f'{repository}@{tag} is missing CI release assets: {", ".join(missing)}')
    result = {}
    for name in names:
        asset = assets[name]
        digest = asset.get('digest') or ''
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
            raise ValueError(f'{repository}@{tag}/{name} has no GitHub SHA256; publish a checksummed CI release')
        result[name] = {'url': asset['browser_download_url'], 'repository': repository,
                        'tag': tag, 'assetId': asset['id'], 'sha256': digest[7:]}
    return result


def required_assets(lock):
    c = lock['components']
    arch = lock['architecture']
    native, scode, k3s = ARCHITECTURES[arch]
    moss_version, webui_version = c['moss']['version'], c['webui']['version']
    requests = {
        'moss': [f'moss-server-image-{moss_version}-linux-{arch}.tar.gz',
                 f'moss-runtime-{moss_version}-linux-{arch}.tar.gz',
                 f'moss-deploy-{moss_version}-linux-{arch}.tar.gz', 'bootstrap-nexus.mjs', 'install.sh', 'SHA256SUMS'],
        'webui': [f'sudowork-webui-{webui_version}-linux-{arch}.tar.gz'],
        'nexus': [f'nexusd-cluster-linux-{native}.tar.gz'],
        'vault': [f'nexus-vault-linux-{native}.tar.gz'],
        'sudocode': [f'scode-linux-{scode}' + ('-bundle' if arch == 'amd64' else '') + '.tar.gz'],
        'k3s': [k3s, f'k3s-airgap-images-{arch}.tar.zst', f'sha256sum-{arch}.txt'],
        'gvisor': [f'gvisor-{native}.tar.bz2'],
    }
    if 'router' in c:
        requests['router'] = [f'sudorouter-{c["router"]["version"]}-linux-{arch}.tar.gz']
    return requests


def resolve(lock):
    c = lock['components']
    requests = required_assets(lock)
    resolved, errors = {}, []
    for name, names in requests.items():
        repository = c[name].get('repository', {'k3s': 'k3s-io/k3s', 'gvisor': 'google/gvisor'}.get(name))
        tag = c[name].get('tag', c[name]['version'])
        try:
            resolved[name] = release_assets(repository, tag, names)
        except (ValueError, subprocess.CalledProcessError) as error:
            errors.append(str(error))
    if errors:
        raise ValueError('Upstream release preflight failed:\n' + '\n'.join(errors))
    if resolved['sudocode'][requests['sudocode'][0]]['sha256'] != c['sudocode']['sha256']:
        raise ValueError('Sudocode release checksum differs from the deployment lock')
    if 'baseRelease' in lock:
        base = lock['baseRelease']
        source = release_assets(base['repository'], base['tag'], ['atlas-release.json'])['atlas-release.json']
        if source['sha256'] != base['manifestSha256']:
            raise ValueError('Base release manifest checksum differs from the lock')
        with tempfile.TemporaryDirectory(prefix='atlas-base-') as tmp:
            path = Path(tmp) / 'atlas-release.json'
            download(source['url'], path, source['sha256'])
            manifest = json.loads(path.read_text())
        if manifest['release'] != base['tag'] or manifest['components'] != {k: v for k, v in c.items() if k != 'router'}:
            raise ValueError('Adding SudoRouter must preserve every base component version')
        if manifest['architecture'] != lock['architecture']:
            raise ValueError('Base release architecture differs from the deployment lock; assemble a native release without baseRelease')
        resolved['baseRelease'] = {'source': source, 'manifest': manifest}
    return resolved


def save_image(ref, destination):
    with destination.open('wb') as target:
        save = subprocess.Popen(['docker', 'save', ref], stdout=subprocess.PIPE)
        try:
            subprocess.run(['gzip', '-1n'], stdin=save.stdout, stdout=target, check=True)
        finally:
            save.stdout.close()
        if save.wait():
            raise RuntimeError('docker save failed: ' + ref)


def pull_image(ref, architecture='amd64'):
    subprocess.run(['docker', 'pull', '--platform', 'linux/' + architecture, ref], check=True)
    details = json.loads(subprocess.check_output(['docker', 'image', 'inspect', ref], text=True))[0]
    if details['Architecture'] != architecture or details.get('Os') != 'linux' or not details.get('RepoDigests'):
        raise ValueError('A linux/' + architecture + ' registry image with a digest is required: ' + ref)
    return details['RepoDigests'][0]


def verify_image_archive(path, expected_refs, architecture='amd64'):
    def canonical(ref):
        if '/' not in ref:
            return 'docker.io/library/' + ref
        first = ref.split('/')[0]
        return ref if '.' in first or ':' in first or first == 'localhost' else 'docker.io/' + ref

    with tarfile.open(path) as archive:
        try:
            entries = json.load(archive.extractfile('manifest.json'))
            tagged = {canonical(tag): entry for entry in entries for tag in entry.get('RepoTags', [])}
            for ref in expected_refs:
                if canonical(ref) not in tagged:
                    raise ValueError(f'{path.name} does not contain the locked image {ref}')
                config = json.load(archive.extractfile(tagged[canonical(ref)]['Config']))
                if config.get('architecture') != architecture or config.get('os') != 'linux':
                    raise ValueError(f'{path.name}: {ref} must be a linux/{architecture} image')
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            raise ValueError('Invalid Docker image archive: ' + path.name) from error


def extract_file(archive_path, member_name, destination, executable=False):
    with tarfile.open(archive_path) as archive:
        member = archive.getmember(member_name)
        if not member.isfile():
            raise ValueError('Expected a regular release file: ' + member_name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with archive.extractfile(member) as source, destination.open('wb') as target:
            shutil.copyfileobj(source, target)
    destination.chmod(0o755 if executable else 0o644)


def add_router_archive(metadata, resolved, assets):
    component = metadata['components'].get('router')
    if not component:
        return
    arch = metadata['architecture']
    name = f'sudorouter-{component["version"]}-linux-{arch}.tar.gz'
    source = resolved['router'][name]
    download(source['url'], assets / name, source['sha256'])
    ref = f'docker.io/sudoprivacy/new-api:{component["version"]}-{arch}'
    verify_image_archive(assets / name, [ref], arch)
    metadata['sources'][name] = source
    metadata['imageArchives'].append(name)
    metadata['images']['router'] = ref
    metadata['routerArchive'] = name


def assemble_from_base(lock, resolved, assets):
    base = resolved['baseRelease']['manifest']
    if base['architecture'] != lock['architecture']:
        raise ValueError('Base release architecture differs from the deployment lock')
    metadata = json.loads(json.dumps(base))
    names = set(base['imageArchives']) | {base['mossBootstrap'], base['mossDeploymentBundle'],
        'install.sh', 'SHA256SUMS', base['helm']['archive']}
    names.update(name for name in base['sources'] if name.startswith('offline/'))
    metadata['sources'] = {name: base['sources'][name] for name in sorted(names)}
    assets.mkdir(parents=True, exist_ok=True)
    from artifacts import asset_path
    for name, source in metadata['sources'].items():
        download(source['url'], asset_path(assets, name), base['archives'][name])
    for key in ('archives', 'chart', 'chartVersion', 'installerVersion', 'qualification'):
        metadata.pop(key, None)
    metadata.update(release='sudostack-v' + lock['version'], version=lock['version'], components=lock['components'],
        sourceLock=lock, extends={'release': base['release'], 'archives': base['archives']})
    metadata['buildInputs']['router'] = resolved['router']
    metadata['buildInputs']['baseRelease'] = resolved['baseRelease']['source']
    add_router_archive(metadata, resolved, assets)
    (assets / 'build-input.json').write_text(json.dumps(metadata, indent=2) + '\n')


def assemble(lock, resolved, assets):
    if 'baseRelease' in resolved:
        assemble_from_base(lock, resolved, assets)
        return
    c = lock['components']
    arch = lock['architecture']
    native, _, k3s = ARCHITECTURES[arch]
    version, moss_version, webui_version = lock['version'], c['moss']['version'], c['webui']['version']
    sources = {}
    assets.mkdir(parents=True, exist_ok=True)

    def fetch_component(component, name, target):
        source = resolved[component][name]
        download(source['url'], target, source['sha256'])
        if target.is_relative_to(assets):
            sources[str(target.relative_to(assets))] = source

    for name in resolved['moss']:
        fetch_component('moss', name, assets / name)
    webui_archive = f'sudowork-webui-{webui_version}-linux-{arch}.tar.gz'
    fetch_component('webui', webui_archive, assets / webui_archive)
    offline = assets / 'offline'
    offline.mkdir(exist_ok=True)
    for name, local in [(k3s, f'k3s-{arch}'), (f'k3s-airgap-images-{arch}.tar.zst', f'k3s-airgap-images-{arch}.tar.zst'),
                        (f'sha256sum-{arch}.txt', f'k3s-sha256sum-{arch}.txt')]:
        fetch_component('k3s', name, offline / local)
    installer = github('repos/k3s-io/k3s/contents/install.sh?ref=' + quote(c['k3s']['version'], safe=''))
    (offline / 'k3s-install.sh').write_bytes(base64.b64decode(installer['content']))

    helm_archive = f'helm-{c["helm"]["version"]}-linux-{arch}.tar.gz'
    helm_url = 'https://get.helm.sh/' + helm_archive
    helm_sha = subprocess.check_output(['curl', '-fsSL', '--max-time', '60', helm_url + '.sha256sum'], text=True).split()[0]
    download(helm_url, assets / helm_archive, helm_sha)
    sources[helm_archive] = {'url': helm_url, 'sha256': helm_sha, 'version': c['helm']['version']}

    with tempfile.TemporaryDirectory(prefix='atlas-release-') as tmp:
        build = Path(tmp).resolve()
        gvisor_archive = build / 'gvisor.tar.bz2'
        fetch_component('gvisor', f'gvisor-{native}.tar.bz2', gvisor_archive)
        with tarfile.open(gvisor_archive) as archive:
            members = archive.getmembers()
            for binary in ('runsc', 'containerd-shim-runsc-v1'):
                names = [m.name for m in members if m.isfile() and Path(m.name).name == binary]
                if len(names) != 1:
                    raise ValueError('Missing/ambiguous gVisor binary: ' + binary)
                target = offline / (binary + '-' + arch)
                extract_file(gvisor_archive, names[0], target, executable=True)
                (offline / (target.name + '.sha512')).write_text(hashlib.sha512(target.read_bytes()).hexdigest() + '  ' + target.name + '\n')
            helper_sums = []
            for member in members:
                parts = Path(member.name).parts
                if member.isfile() and len(parts) == 2 and parts[0] == 'gvisor-bin':
                    target = offline / f'gvisor-bin-{arch}' / parts[1]
                    extract_file(gvisor_archive, member.name, target, executable=True)
                    helper_sums.append(hashlib.sha512(target.read_bytes()).hexdigest() + '  ' + target.name)
            (offline / f'gvisor-bin-{arch}').mkdir(exist_ok=True)
            (offline / f'gvisor-bin-{arch}/SHA512SUMS').write_text('\n'.join(helper_sums) + '\n')

        fetch_component('nexus', f'nexusd-cluster-linux-{native}.tar.gz', build / 'nexus.tar.gz')
        fetch_component('vault', f'nexus-vault-linux-{native}.tar.gz', build / 'vault.tar.gz')
        extract_file(build / 'nexus.tar.gz', f'nexusd-cluster-linux-{native}/nexusd-cluster', build / 'nexus/nexusd', True)
        for name in ('libnexus_vault.so', 'libnexus_vault.so.sig'):
            extract_file(build / 'vault.tar.gz', name, build / 'nexus/plugins' / name)
        kubectl_version = c['k3s']['version'].split('+')[0]
        kubectl_url = f'https://dl.k8s.io/release/{kubectl_version}/bin/linux/{arch}/kubectl'
        kubectl_sha = subprocess.check_output(['curl', '-fsSL', '--max-time', '60', kubectl_url + '.sha256'], text=True).strip()
        download(kubectl_url, build / 'kubectl', kubectl_sha)
        node_image = pull_image(c['nexusBase']['image'], arch)
        nexus_image = f'docker.io/library/atlas-nexus:{version}-{arch}'
        subprocess.run(['docker', 'buildx', 'build', '--platform', 'linux/' + arch, '--load',
                        '--build-arg', 'NODE_IMAGE=' + node_image, '-t', nexus_image,
                        '-f', str(HERE / 'nexus.Dockerfile'), str(build)], check=True)
        nexus_archive = f'atlas-nexus-{version}-linux-{arch}.tar.gz'
        save_image(nexus_image, assets / nexus_archive)

    caddy_digest = pull_image(c['caddy']['image'], arch)
    caddy_archive = f'caddy-{c["caddy"]["version"]}-linux-{arch}.tar.gz'
    save_image(c['caddy']['image'], assets / caddy_archive)
    runtime_archive = f'moss-runtime-{moss_version}-linux-{arch}.tar.gz'
    # Inspect the actual owner-built runtime, including its embedded Sudocode.
    runtime_image = f'docker.io/library/my-moss-runtime:{moss_version}-{arch}'
    verify_image_archive(assets / runtime_archive, [runtime_image], arch)
    subprocess.run(['docker', 'load', '-i', str(assets / runtime_archive)], check=True)
    scode_version = subprocess.check_output(['docker', 'run', '--rm', '--entrypoint', 'scode', runtime_image, '--version'], text=True)
    if not re.search(r'(?<![0-9.])' + re.escape(c['sudocode']['version']) + r'(?![0-9.])', scode_version):
        raise ValueError('The Moss runtime does not contain the locked Sudocode version')

    metadata = {
        'release': 'sudostack-v' + version, 'version': version, 'architecture': arch,
        'components': c, 'sourceLock': lock, 'buildInputs': resolved,
        'registryInputs': {'nexusBase': node_image, 'caddy': caddy_digest}, 'sources': sources,
        'imageArchives': [f'moss-server-image-{moss_version}-linux-{arch}.tar.gz', runtime_archive, nexus_archive, webui_archive, caddy_archive],
        'images': {'moss': f'docker.io/library/moss-server:{moss_version}-{arch}', 'nexus': nexus_image,
                   'runtime': runtime_image, 'webui': f'docker.io/library/sudowork-webui:{webui_version}',
                   'postgres': c['postgres']['image'], 'caddy': c['caddy']['image']},
        'mossBootstrap': 'bootstrap-nexus.mjs', 'mossDeploymentBundle': f'moss-deploy-{moss_version}-linux-{arch}.tar.gz',
        'mossVersion': moss_version, 'helm': {'version': c['helm']['version'], 'archive': helm_archive},
        'k3s': c['k3s']['version'], 'gvisor': c['gvisor']['version'], 'nexus': c['nexus'],
        'sudocode': c['sudocode'], 'runtimeClass': 'gvisor',
    }
    for name, components in zip(metadata['imageArchives'], [('moss',), ('runtime',), ('nexus',), ('webui', 'postgres'), ('caddy',)]):
        verify_image_archive(assets / name, [metadata['images'][component] for component in components], arch)
        print('Verified locked image tags and architecture: ' + name, flush=True)
    add_router_archive(metadata, resolved, assets)
    (assets / 'build-input.json').write_text(json.dumps(metadata, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', required=True, type=Path)
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--validate', action='store_true', help='Validate local version pins without downloading')
    parser.add_argument('--check', action='store_true', help='Check exact upstream releases without downloading images')
    args = parser.parse_args()
    lock = read_lock(args.lock)
    if args.validate:
        print('Deployment version lock valid: ' + lock['version'])
        return
    resolved = resolve(lock)
    if args.check:
        print('All pinned component release assets are available')
        return
    if args.assets is None:
        parser.error('--assets is required for assembly')
    assemble(lock, resolved, args.assets.resolve())


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
