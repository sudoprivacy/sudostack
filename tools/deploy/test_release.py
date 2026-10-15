import copy
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import artifacts
import atlas
import package
import release
import router

ROOT = Path(__file__).resolve().parents[2]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='atlas-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.lock = json.loads((ROOT / 'manifests/deployment/0.0.1.json').read_text())

    def read_lock(self, value):
        path = self.root / 'lock.json'
        path.write_text(json.dumps(value))
        return release.read_lock(path)

    def test_fixed_versions_and_owner_tags(self):
        self.assertEqual(self.read_lock(self.lock)['version'], '0.0.1')
        for name, field, value in [('moss', 'version', 'latest'), ('webui', 'tag', 'v9.9.9'),
                                   ('nexus', 'repository', 'sudoprivacy/moss'), ('caddy', 'image', 'caddy:latest'),
                                   ('caddy', 'image', 'docker.io/library/caddy:2.10.3-alpine'),
                                   ('router', 'repository', 'calciumion/new-api'), ('router', 'tag', 'latest')]:
            with self.subTest(component=name, field=field):
                lock = copy.deepcopy(self.lock)
                lock['components'][name][field] = value
                with self.assertRaises(ValueError):
                    self.read_lock(lock)

    def test_release_lock_accepts_only_supported_architectures(self):
        for architecture in ('amd64', 'arm64'):
            self.lock['architecture'] = architecture
            self.assertEqual(self.read_lock(self.lock)['architecture'], architecture)
        self.lock['architecture'] = 'aarch64'
        with self.assertRaisesRegex(ValueError, 'amd64 or arm64'):
            self.read_lock(self.lock)

    def test_arm64_preflight_uses_native_owner_assets_and_pinned_sudocode_checksum(self):
        self.lock['architecture'] = 'arm64'
        self.lock.pop('baseRelease')
        def assets(repository, tag, names):
            return {name: {'sha256': self.lock['components']['sudocode']['sha256']} for name in names}
        with patch.object(release, 'release_assets', side_effect=assets):
            resolved = release.resolve(self.lock)
        self.assertIn('nexusd-cluster-linux-aarch64.tar.gz', resolved['nexus'])
        self.assertIn('nexus-vault-linux-aarch64.tar.gz', resolved['vault'])
        self.assertIn('gvisor-aarch64.tar.bz2', resolved['gvisor'])
        self.assertEqual(set(resolved['k3s']), {'k3s-arm64', 'k3s-airgap-images-arm64.tar.zst', 'sha256sum-arm64.txt'})
        self.assertIn('scode-linux-arm64.tar.gz', resolved['sudocode'])
        with patch.object(release, 'release_assets', side_effect=lambda repo, tag, names: {name: {'sha256': '0' * 64} for name in names}):
            with self.assertRaisesRegex(ValueError, 'Sudocode release checksum'):
                release.resolve(self.lock)

    def test_arm64_base_cannot_reuse_amd64_images(self):
        self.lock['architecture'] = 'arm64'
        resolved = {'baseRelease': {'manifest': {'architecture': 'amd64'}}}
        with patch.object(release, 'download') as download:
            with self.assertRaisesRegex(ValueError, 'Base release architecture'):
                release.assemble_from_base(self.lock, resolved, self.root / 'assets')
            download.assert_not_called()
        self.assertFalse((self.root / 'assets').exists())

    def test_arm64_assembly_packages_native_binaries_images_and_installer(self):
        self.lock['architecture'] = 'arm64'
        self.lock.pop('baseRelease')
        c = self.lock['components']
        def tar_bytes(files):
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                for name, raw in files.items():
                    member = tarfile.TarInfo(name)
                    member.size = len(raw)
                    archive.addfile(member, io.BytesIO(raw))
            return buffer.getvalue()
        def image_bytes(refs):
            entries, files = [], {}
            for index, ref in enumerate(refs):
                name = f'config-{index}.json'
                entries.append({'Config': name, 'RepoTags': [ref]})
                files[name] = b'{"architecture":"arm64","os":"linux"}'
            files['manifest.json'] = json.dumps(entries).encode()
            return tar_bytes(files)
        native = {
            'nexusd-cluster-linux-aarch64.tar.gz': tar_bytes({'nexusd-cluster-linux-aarch64/nexusd-cluster': b'arm64 nexus'}),
            'nexus-vault-linux-aarch64.tar.gz': tar_bytes({'libnexus_vault.so': b'arm64 vault', 'libnexus_vault.so.sig': b'signature'}),
            'gvisor-aarch64.tar.bz2': tar_bytes({'runsc': b'arm64 runsc', 'containerd-shim-runsc-v1': b'arm64 shim', 'gvisor-bin/helper': b'helper'}),
            f'moss-server-image-{c["moss"]["version"]}-linux-arm64.tar.gz': image_bytes([f'moss-server:{c["moss"]["version"]}-arm64']),
            f'moss-runtime-{c["moss"]["version"]}-linux-arm64.tar.gz': image_bytes([f'my-moss-runtime:{c["moss"]["version"]}-arm64']),
            f'sudowork-webui-{c["webui"]["version"]}-linux-arm64.tar.gz': image_bytes([f'sudowork-webui:{c["webui"]["version"]}', c['postgres']['image']]),
            f'sudorouter-{c["router"]["version"]}-linux-arm64.tar.gz': image_bytes([f'sudoprivacy/new-api:{c["router"]["version"]}-arm64']),
        }
        requests = release.required_assets(self.lock)
        resolved = {component: {name: {'url': 'https://owner.test/' + name,
                    'sha256': hashlib.sha256(native.get(name, name.encode())).hexdigest()} for name in names}
                    for component, names in requests.items()}
        def download(url, target, digest):
            name = url.rsplit('/', 1)[1]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(native.get(name, name.encode()))
        def check_output(command, **kwargs):
            if command[0] == 'curl':
                name = command[-1].rsplit('/', 1)[1].removesuffix('.sha256sum').removesuffix('.sha256')
                return hashlib.sha256(native.get(name, name.encode())).hexdigest()
            if command[:2] == ['docker', 'run']:
                return c['sudocode']['version']
            self.fail('Unexpected subprocess: ' + repr(command))
        def pull(ref, architecture):
            self.assertEqual(architecture, 'arm64')
            return ref + '@sha256:' + 'b' * 64
        assets = self.root / 'assets'
        with patch.object(release, 'download', side_effect=download), \
             patch.object(release, 'github', return_value={'content': base64.b64encode(b'#!/bin/sh\n').decode()}), \
             patch.object(release, 'pull_image', side_effect=pull), \
             patch.object(release, 'save_image', side_effect=lambda ref, path: path.write_bytes(image_bytes([ref]))), \
             patch.object(release.subprocess, 'check_output', side_effect=check_output), \
             patch.object(release.subprocess, 'run') as run:
            release.assemble(self.lock, resolved, assets)
        build = next(call.args[0] for call in run.call_args_list if call.args[0][:3] == ['docker', 'buildx', 'build'])
        self.assertEqual(build[build.index('--platform') + 1], 'linux/arm64')
        self.assertEqual((assets / 'offline/k3s-arm64').read_bytes(), b'k3s-arm64')
        self.assertEqual((assets / 'offline/runsc-arm64').read_bytes(), b'arm64 runsc')
        self.assertEqual((assets / 'offline/containerd-shim-runsc-v1-arm64').read_bytes(), b'arm64 shim')
        self.assertTrue((assets / 'offline/gvisor-bin-arm64/SHA512SUMS').is_file())
        package.package(assets, self.root / 'publish')
        manifest = json.loads((assets / 'atlas-release.json').read_text())
        self.assertEqual(manifest['architecture'], 'arm64')
        self.assertEqual(manifest['sourceLock']['architecture'], 'arm64')
        self.assertTrue(manifest['helm']['archive'].endswith('-linux-arm64.tar.gz'))
        self.assertTrue(all(name.endswith('-linux-arm64.tar.gz') for name in manifest['imageArchives']))
        self.assertFalse(any('amd64' in name or 'x86_64' in name for name in manifest['archives']))

    def test_arm64_host_validation_rejects_wrong_bundle_and_page_size(self):
        with patch.object(atlas.platform, 'system', return_value='Linux'), \
             patch.object(atlas.platform, 'machine', return_value='aarch64'), \
             patch.object(atlas.os, 'sysconf', return_value=4096) as pages:
            self.assertEqual(atlas.validate_host({'architecture': 'arm64'}), 'arm64')
            with self.assertRaisesRegex(ValueError, 'Architecture mismatch'):
                atlas.validate_host({'architecture': 'amd64'})
            pages.return_value = 65536
            with self.assertRaisesRegex(ValueError, '4096-byte'):
                atlas.validate_host({'architecture': 'arm64'})

    def test_incompatible_host_fails_before_installation_root_is_created(self):
        assets, chart = self.root / 'assets', self.root / 'chart'
        assets.mkdir()
        chart.mkdir()
        (chart / 'Chart.yaml').write_text('name: atlas-mvp')
        (assets / 'atlas-release.json').write_text('{"architecture":"amd64"}')
        args = SimpleNamespace(root=self.root / 'installation', assets=assets, chart=chart)
        with patch.object(atlas.platform, 'system', return_value='Linux'), \
             patch.object(atlas.platform, 'machine', return_value='aarch64'), patch.object(atlas, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Architecture mismatch'):
                atlas.install(args)
            run.assert_not_called()
        self.assertFalse(args.root.exists())

    def test_existing_multi_node_cluster_fails_before_installation_root_is_created(self):
        assets, chart = self.root / 'assets', self.root / 'chart'
        assets.mkdir()
        chart.mkdir()
        (chart / 'Chart.yaml').write_text('name: atlas-mvp')
        (assets / 'atlas-release.json').write_text('{"architecture":"arm64"}')
        args = SimpleNamespace(root=self.root / 'installation', assets=assets, chart=chart)
        nodes = subprocess.CompletedProcess([], 0, json.dumps({'items': [{}, {}]}))
        with patch.object(atlas, 'validate_host', return_value='arm64'), \
             patch.object(atlas.shutil, 'which', side_effect=lambda name: '/usr/local/bin/k3s' if name == 'k3s' else None), \
             patch.object(atlas.subprocess, 'run', return_value=nodes) as run:
            with self.assertRaisesRegex(ValueError, 'existing multi-node cluster'):
                atlas.install(args)
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0][:4], ['k3s', 'kubectl', 'get', 'nodes'])
        self.assertFalse(args.root.exists())

    def test_existing_agent_without_admin_kubeconfig_is_rejected_before_mutation(self):
        assets, chart = self.root / 'assets', self.root / 'chart'
        assets.mkdir()
        chart.mkdir()
        (chart / 'Chart.yaml').write_text('name: atlas-mvp')
        (assets / 'atlas-release.json').write_text('{"architecture":"arm64"}')
        args = SimpleNamespace(root=self.root / 'installation', assets=assets, chart=chart)
        with patch.object(atlas, 'validate_host', return_value='arm64'), \
             patch.object(atlas.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name), \
             patch.object(atlas.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            with self.assertRaisesRegex(ValueError, 'existing k3s-agent'):
                atlas.install(args)
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0], ['/usr/bin/systemctl', 'is-active', '--quiet', 'k3s-agent'])
        self.assertFalse(args.root.exists())

    def test_unreadable_active_server_cluster_is_not_treated_as_a_clean_host(self):
        responses = [subprocess.CompletedProcess([], 3), subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0)]
        with patch.object(atlas.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name), \
             patch.object(atlas.subprocess, 'run', side_effect=responses):
            with self.assertRaisesRegex(ValueError, 'Cannot inspect the existing active k3s cluster'):
                atlas.preflight_existing_cluster()

    def test_router_release_requires_all_components_and_an_immutable_base(self):
        for mutate in (lambda lock: lock['components'].pop('router'),
                       lambda lock: lock['baseRelease'].update(manifestSha256=''),
                       lambda lock: lock['baseRelease'].update(tag='main')):
            lock = copy.deepcopy(self.lock)
            mutate(lock)
            with self.assertRaises(ValueError):
                self.read_lock(lock)

    def test_router_addition_rejects_any_change_to_existing_components(self):
        previous = {'release': 'sudostack-v0.0.1-rc.2', 'archives': {'moss.tar.gz': 'a' * 64},
            'imageArchives': ['moss.tar.gz'], 'images': {'moss': 'moss:1'}, 'components': {'moss': {'version': '1'}}}
        candidate = {**copy.deepcopy(previous), 'release': 'sudostack-v0.0.1-rc.3',
            'extends': {'release': previous['release'], 'archives': copy.deepcopy(previous['archives'])}}
        candidate['images']['router'] = 'sudoprivacy/new-api:1'
        candidate['components']['router'] = {'version': '1'}
        atlas.validate_router_addition(previous, candidate)
        for mutate in (lambda m: m['extends'].update(release='another-release'),
                       lambda m: m['archives'].update({'moss.tar.gz': 'b' * 64}),
                       lambda m: m['images'].update(moss='moss:2'),
                       lambda m: m['components']['moss'].update(version='2')):
            changed = copy.deepcopy(candidate)
            mutate(changed)
            with self.assertRaises(ValueError):
                atlas.validate_router_addition(previous, changed)

    def test_router_will_not_replace_customer_model_credentials(self):
        with patch.object(router, 'moss_settings', return_value={'url': 'https://customer.example/v1', 'apiKeyConfigured': True}):
            with self.assertRaises(ValueError):
                router.assert_moss_configuration(self.root)
        with patch.object(router, 'moss_settings', return_value={'url': '', 'apiKeyConfigured': False}):
            router.assert_moss_configuration(self.root)
        (self.root / 'router-credentials.json').write_text('{}')
        with patch.object(router, 'moss_settings', return_value={'url': router.MODEL_URL, 'apiKeyConfigured': True}):
            router.assert_moss_configuration(self.root)

    def test_base_assembly_retains_owner_bytes_and_replaces_deployment_files(self):
        names = ['moss.tar.gz', 'bootstrap.mjs', 'deploy.tar.gz', 'install.sh', 'SHA256SUMS', 'helm.tar.gz', 'offline/k3s']
        sources = {name: {'url': 'https://github.com/owner/release/' + name,
            'sha256': hashlib.sha256(name.encode()).hexdigest()} for name in names + ['atlas.py', 'old-chart.tgz']}
        base = {'release': 'sudostack-v0.0.1-rc.2', 'version': '0.0.1-rc.2', 'architecture': 'amd64', 'sources': sources,
            'imageArchives': ['moss.tar.gz'], 'images': {'moss': 'moss:1'}, 'mossBootstrap': 'bootstrap.mjs',
            'mossDeploymentBundle': 'deploy.tar.gz', 'helm': {'archive': 'helm.tar.gz'}, 'buildInputs': {},
            'chart': 'old-chart.tgz', 'archives': {k: v['sha256'] for k, v in sources.items()}}
        resolved = {'baseRelease': {'manifest': base, 'source': {}}, 'router': {}}
        def download(url, target, digest):
            name = url.removeprefix('https://github.com/owner/release/')
            self.assertEqual(hashlib.sha256(name.encode()).hexdigest(), digest)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(name.encode())
        with patch.object(release, 'download', side_effect=download), patch.object(release, 'add_router_archive'):
            release.assemble_from_base(self.lock, resolved, self.root / 'assets')
        result = json.loads((self.root / 'assets/build-input.json').read_text())
        self.assertEqual(set(result['sources']), set(names))
        self.assertEqual(result['images'], base['images'])
        self.assertEqual(result['extends']['archives'], base['archives'])
        self.assertNotIn('chart', result)

    def test_release_preflight_rejects_missing_assets_before_assembly(self):
        metadata = {'tag_name': 'v1.0.0', 'assets': []}
        with patch.object(release, 'github', return_value=metadata):
            with self.assertRaisesRegex(ValueError, 'missing CI release assets: image.tar.gz'):
                release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])

    def test_release_metadata_requires_digest_and_exact_published_tag(self):
        asset = {'name': 'image.tar.gz', 'id': 123,
                 'browser_download_url': 'https://github.com/owner/component/releases/download/v1.0.0/image.tar.gz',
                 'digest': 'sha256:' + 'a' * 64}
        metadata = {'tag_name': 'v1.0.0', 'assets': [asset]}
        with patch.object(release, 'github', return_value=metadata):
            result = release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])
            self.assertEqual(result['image.tar.gz']['sha256'], 'a' * 64)
            asset['digest'] = None
            with self.assertRaises(ValueError):
                release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])
            asset['digest'] = 'sha256:' + 'a' * 64
            metadata['draft'] = True
            with self.assertRaises(ValueError):
                release.release_assets('owner/component', 'v1.0.0', ['image.tar.gz'])

    def test_download_cache_and_checksum_failure_are_atomic(self):
        target = self.root / 'image.tar.gz'
        target.write_bytes(b'existing')
        expected = hashlib.sha256(b'correct image').hexdigest()

        def transfer(command, **kwargs):
            Path(command[command.index('--output') + 1]).write_bytes(b'truncated image')

        with patch.object(artifacts.subprocess, 'run', side_effect=transfer):
            with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                artifacts.download('https://github.com/owner/repo/image.tar.gz', target, expected)
        self.assertEqual(target.read_bytes(), b'existing')
        self.assertEqual(list(self.root.glob('*.part')), [])
        target.write_bytes(b'correct image')
        with patch.object(artifacts.subprocess, 'run') as transfer:
            artifacts.download('https://github.com/owner/repo/image.tar.gz', target, expected)
            transfer.assert_not_called()

    def test_image_archive_must_contain_every_locked_image_and_architecture(self):
        path = self.root / 'webui.tar.gz'
        def bundle(architecture):
            files = {'manifest.json': [{'Config': 'config.json', 'RepoTags': ['sudowork-webui:0.2.28']}],
                     'config.json': {'architecture': architecture, 'os': 'linux'}}
            with tarfile.open(path, 'w:gz') as archive:
                for name, value in files.items():
                    raw = json.dumps(value).encode()
                    member = tarfile.TarInfo(name)
                    member.size = len(raw)
                    archive.addfile(member, io.BytesIO(raw))
        bundle('amd64')
        release.verify_image_archive(path, ['docker.io/library/sudowork-webui:0.2.28'])
        with self.assertRaisesRegex(ValueError, 'locked image'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.29'])
        with self.assertRaisesRegex(ValueError, 'locked image'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.28', 'postgres:16-alpine'])
        bundle('arm64')
        release.verify_image_archive(path, ['sudowork-webui:0.2.28'], 'arm64')
        with self.assertRaisesRegex(ValueError, 'linux/amd64'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.28'])
        bundle('amd64')
        with self.assertRaisesRegex(ValueError, 'linux/arm64'):
            release.verify_image_archive(path, ['sudowork-webui:0.2.28'], 'arm64')

    def test_runtime_prerelease_cannot_satisfy_a_stable_version_lock(self):
        release.verify_runtime_version('scode 0.2.32\n', '0.2.32')
        release.verify_runtime_version('scode 0.2.32-rc.1\n', '0.2.32-rc.1')
        for output in ('scode 0.2.32-rc.1', 'scode 0.2.32+local', 'scode 0.2.320', 'scode 10.2.32'):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'locked Sudocode version'):
                release.verify_runtime_version(output, '0.2.32')

    def test_fetch_rejects_paths_before_network_access(self):
        for name in ('../outside', '/absolute', 'offline/../../outside', './file'):
            with self.subTest(name=name), patch.object(artifacts, 'download') as download:
                with self.assertRaises(ValueError):
                    artifacts.fetch({'archives': {name: 'a' * 64}}, self.root)
                download.assert_not_called()
        outside = self.root / 'outside'
        outside.mkdir()
        assets = self.root / 'assets'
        assets.mkdir()
        (assets / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            artifacts.asset_path(assets, 'link/file')

    def test_another_installation_root_cannot_replace_cluster_credentials(self):
        existing = {'metadata': {'annotations': {'sudostack.io/install-root': '/data/original'}}}
        with patch.object(atlas, 'kube', return_value=json.dumps(existing)), patch.object(atlas, 'apply') as apply:
            with self.assertRaisesRegex(ValueError, 'already managed'):
                atlas.claim_namespace(Path('/data/another-root'))
            apply.assert_not_called()
            atlas.claim_namespace(Path('/data/original'))
            apply.assert_called_once()

    def test_package_round_trip_preserves_owner_sources_and_versions(self):
        assets, publish, destination = (self.root / name for name in ('assets', 'publish', 'customer'))
        assets.mkdir()
        (assets / 'offline').mkdir()
        for name in ('moss.tar.gz', 'webui.tar.gz', 'nexus.tar.gz', 'offline/runsc-amd64'):
            (assets / name).write_bytes(name.encode())
        # Unrelated local state must not become release material.
        (assets / 'credentials.json').write_text('{"password":"not-a-release-asset"}')
        sources = {name: {'url': f'https://github.com/owner/component/releases/download/v1.0.0/{name}',
                          'sha256': artifacts.checksum(assets / name)} for name in ('moss.tar.gz', 'webui.tar.gz')}
        metadata = {'release': 'sudostack-v0.0.1', 'version': '0.0.1', 'architecture': 'amd64', 'sourceLock': self.lock,
                    'sources': sources, 'imageArchives': ['moss.tar.gz', 'webui.tar.gz', 'nexus.tar.gz']}
        (assets / 'build-input.json').write_text(json.dumps(metadata))
        package.package(assets, publish)
        manifest = json.loads((publish / 'atlas-release.json').read_text())
        self.assertEqual(manifest['sources']['moss.tar.gz'], sources['moss.tar.gz'])
        self.assertNotIn('moss.tar.gz', [p.name for p in publish.iterdir()])
        self.assertNotIn('credentials.json', manifest['archives'])
        self.assertIn('/sudostack-v0.0.1/offline--runsc-amd64', manifest['sources']['offline/runsc-amd64']['url'])
        self.assertNotIn('@@ATLAS_RELEASE_TAG@@', (publish / 'install-atlas.sh').read_text())
        self.assertIn('cleanup-atlas.sh', manifest['archives'])
        with tarfile.open(publish / manifest['chart']) as chart:
            text = chart.extractfile('atlas-mvp/Chart.yaml').read().decode()
            self.assertIn('version: 0.0.1\n', text)
            self.assertIn('appVersion: "0.0.1"', text)

        remote = {source['url']: (assets / name).read_bytes() for name, source in manifest['sources'].items()}

        def transfer(command, **kwargs):
            url = command[command.index('--output') - 1]
            Path(command[command.index('--output') + 1]).write_bytes(remote[url])

        with patch.object(artifacts.subprocess, 'run', side_effect=transfer):
            artifacts.fetch(manifest, destination)
        for name, expected in manifest['archives'].items():
            self.assertEqual(artifacts.checksum(destination / name), expected)
        # The same downloaded layout must also form a complete offline bundle.
        (destination / 'atlas-release.json').write_text(json.dumps(manifest))
        bundle = self.root / 'offline.tar'
        subprocess.run([sys.executable, str(ROOT / 'tools/deploy/bundle.py'), '--assets', str(destination), '--output', str(bundle)], check=True, capture_output=True)
        with tarfile.open(bundle) as archive:
            self.assertIn('offline/runsc-amd64', archive.getnames())
            self.assertNotIn('credentials.json', archive.getnames())


if __name__ == '__main__':
    unittest.main()
