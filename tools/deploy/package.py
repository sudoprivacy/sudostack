#!/usr/bin/env python3
"""Bind deployment files and verified component releases to one sudostack version."""
import argparse
import json
from pathlib import Path
import shutil
import tarfile

from artifacts import checksum, release_url

SCRIPTS = ('atlas.py', 'artifacts.py', 'install-atlas.sh', 'smoke.py',
           'webui-smoke.cjs', 'mock-openai-server.mjs', 'snapshot.py')


def package(assets, publish):
    metadata = json.loads((assets / 'build-input.json').read_text())
    repository = metadata['sourceLock']['repository']
    release = metadata['release']
    root = Path(__file__).resolve().parents[2]
    chart = 'atlas-mvp-' + metadata['version'] + '.tgz'
    # Chart and installer versions follow the suite release, independently of
    # each component version. All are frozen by the same release manifest.
    chart_dir = assets / '.chart/atlas-mvp'
    shutil.copytree(root / 'charts/atlas-mvp', chart_dir, dirs_exist_ok=True)
    chart_metadata = chart_dir / 'Chart.yaml'
    lines = chart_metadata.read_text().splitlines()
    chart_metadata.write_text('\n'.join(
        'version: ' + metadata['version'] if line.startswith('version:') else
        'appVersion: "' + metadata['version'] + '"' if line.startswith('appVersion:') else line
        for line in lines) + '\n')
    with tarfile.open(assets / chart, 'w:gz') as archive:
        archive.add(chart_dir, arcname='atlas-mvp')
    shutil.rmtree(assets / '.chart')
    for filename in SCRIPTS:
        text = Path(__file__).with_name(filename).read_text()
        if filename == 'install-atlas.sh':
            text = text.replace('@@ATLAS_RELEASE_TAG@@', release)
        (assets / filename).write_text(text)
    (assets / 'components.lock.json').write_text(json.dumps(metadata['sourceLock'], indent=2) + '\n')
    metadata.update(chart=chart, chartVersion=metadata['version'], installerVersion=metadata['version'],
                    qualification='CI assembled candidate; deployment qualification required')
    sources = metadata['sources']
    # Only owner downloads, generated offline dependencies and deployment files
    # can enter a release. Ignore unrelated files in the working directory.
    names = set(sources) | set(metadata['imageArchives']) | set(SCRIPTS) | {chart, 'components.lock.json'}
    names.update(str(p.relative_to(assets)) for p in (assets / 'offline').rglob('*') if p.is_file())
    publish.mkdir(parents=True, exist_ok=True)
    if any(publish.iterdir()):
        raise ValueError('Publish directory must be empty')
    metadata['archives'] = {}
    for name in sorted(names):
        path = assets / name
        digest = checksum(path)
        if name in sources and sources[name]['sha256'] != digest:
            raise ValueError('Owner release asset changed after download: ' + name)
        metadata['archives'][name] = digest
        if name not in sources:
            asset_name = name.replace('/', '--')
            if (publish / asset_name).exists():
                raise ValueError('Duplicate publication asset: ' + asset_name)
            shutil.copyfile(path, publish / asset_name)
            sources[name] = {'url': release_url(repository, release, asset_name),
                             'repository': repository, 'tag': release, 'sha256': digest}
    (assets / 'atlas-release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    shutil.copyfile(assets / 'atlas-release.json', publish / 'atlas-release.json')
    (publish / 'SHA256SUMS').write_text(''.join(
        checksum(path) + '  ' + path.name + '\n' for path in sorted(publish.iterdir()) if path.is_file()))
    print('Assembled ' + release + '; component images remain at their owner release URLs')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True, type=Path)
    parser.add_argument('--publish', required=True, type=Path)
    args = parser.parse_args()
    package(args.assets.resolve(), args.publish.resolve())


if __name__ == '__main__':
    main()
