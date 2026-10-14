#!/usr/bin/env python3
"""Write a portable, checksummed archive containing only release assets."""
import argparse
import gzip
import json
from pathlib import Path
import tarfile

from artifacts import asset_path, checksum


def create_archive(assets, output):
    assets, output = assets.resolve(), output.resolve()
    manifest = json.loads((assets / 'atlas-release.json').read_text())
    names = ['atlas-release.json', *sorted(manifest['archives'])]
    for name in names:
        path = asset_path(assets, name)
        if not path.is_file() or (name != 'atlas-release.json' and checksum(path) != manifest['archives'][name]):
            raise ValueError('Invalid release asset: ' + name)
        if path == output:
            raise ValueError('Bundle output cannot replace a release asset')
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + '.part')
    try:
        with temporary.open('wb') as raw:
            stream = gzip.GzipFile(filename='', fileobj=raw, mode='wb', compresslevel=1, mtime=0) if output.name.endswith('.gz') else raw
            try:
                with tarfile.open(fileobj=stream, mode='w|') as archive:
                    for name in names:
                        path = asset_path(assets, name)
                        member = archive.gettarinfo(str(path), arcname=name)
                        member.uid = member.gid = member.mtime = 0
                        member.uname = member.gname = ''
                        member.mode = 0o755 if name.endswith('.sh') else 0o644
                        with path.open('rb') as source:
                            archive.addfile(member, source)
            finally:
                if stream is not raw:
                    stream.close()
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    Path(str(output) + '.sha256').write_text(checksum(output) + '  ' + output.name + '\n')
    print('Bundle: ' + str(output), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    create_archive(args.assets, args.output)


if __name__ == '__main__':
    main()
