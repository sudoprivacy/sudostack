#!/usr/bin/env python3
"""Write a portable candidate archive without customer installation data."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

parser=argparse.ArgumentParser()
parser.add_argument('--assets',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
assets=args.assets.resolve()
manifest=json.loads((assets/'atlas-release.json').read_text())
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
for name,expected in manifest['archives'].items():
    file=assets/name
    if not file.resolve().is_relative_to(assets) or not file.is_file() or file.is_symlink() or digest(file)!=expected:
        raise SystemExit('Invalid release asset: '+name)
with tarfile.open(args.output,'w') as archive:
    for name in ['atlas-release.json',*manifest['archives']]:archive.add(assets/name,arcname=name,recursive=False)
Path(str(args.output)+'.sha256').write_text(digest(args.output)+'  '+args.output.name+'\n')
print('Bundle: '+str(args.output))
