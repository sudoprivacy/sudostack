#!/usr/bin/env bash
set -euo pipefail
ATLAS_ASSETS="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$EUID" -ne 0 ]]; then
  echo 'Run this installer as root.' >&2
  exit 1
fi
# Published installers are stamped with their suite release. Component versions
# come from that release's manifest, never from component latest tags.
ATLAS_RELEASE_TAG="${ATLAS_RELEASE_TAG:-@@ATLAS_RELEASE_TAG@@}"
if [[ ! -f "$ATLAS_ASSETS/atlas-release.json" ]]; then
  if [[ "$ATLAS_RELEASE_TAG" == *'@@'* ]]; then
    echo 'Download install-atlas.sh from a sudostack Release, or set ATLAS_RELEASE_TAG=sudostack-vX.Y.Z.' >&2
    exit 1
  fi
  [[ "$ATLAS_RELEASE_TAG" =~ ^sudostack-v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || {
    echo 'Invalid sudostack release tag.' >&2; exit 1;
  }
  ATLAS_ASSETS="${ATLAS_CACHE_DIR:-/var/cache/sudostack}/$ATLAS_RELEASE_TAG"
  install -d -m 700 "$ATLAS_ASSETS"
  exec 9>"$ATLAS_ASSETS/.download.lock"
  flock 9
  python3 - "$ATLAS_ASSETS" "$ATLAS_RELEASE_TAG" <<'PY'
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
os.umask(0o077)
assets,tag=Path(sys.argv[1]),sys.argv[2]
base='https://github.com/sudoprivacy/sudostack/releases/download/'+tag+'/'
def fetch(name):
    with tempfile.NamedTemporaryFile(dir=assets,delete=False) as output:
        temporary=Path(output.name)
    try:
        subprocess.run(['curl','--http1.1','-fsSL','--proto','=https','--proto-redir','=https',
            '--connect-timeout','20','--max-time','120','--retry','3','--retry-all-errors',base+name,'-o',str(temporary)],check=True)
        return temporary.read_bytes()
    finally:
        temporary.unlink(missing_ok=True)
manifest_path=assets/'atlas-release.json'
raw=manifest_path.read_bytes() if manifest_path.exists() else fetch('atlas-release.json')
try:
    manifest=json.loads(raw)
except (ValueError,UnicodeError):
    raw=fetch('atlas-release.json')
    manifest=json.loads(raw)
if manifest['release']!=tag:
    raise SystemExit('Suite release does not match requested version')
helper_path=assets/'artifacts.py'
helper=helper_path.read_bytes() if helper_path.exists() else b''
if hashlib.sha256(helper).hexdigest()!=manifest['archives']['artifacts.py']:
    helper=fetch('artifacts.py')
if hashlib.sha256(helper).hexdigest()!=manifest['archives']['artifacts.py']:
    raise SystemExit('Release downloader checksum mismatch')
def save(path,content):
    with tempfile.NamedTemporaryFile(dir=assets,delete=False) as output:
        output.write(content)
        temporary=Path(output.name)
    temporary.replace(path)
save(helper_path,helper)
save(manifest_path,raw)
PY
  python3 "$ATLAS_ASSETS/artifacts.py" --manifest "$ATLAS_ASSETS/atlas-release.json" --assets "$ATLAS_ASSETS"
  flock -u 9
fi
ATLAS_CHART_DIR="$(mktemp -d)"
trap 'rm -rf -- "$ATLAS_CHART_DIR"' EXIT
python3 - "$ATLAS_ASSETS" "$ATLAS_CHART_DIR" <<'PY'
import hashlib,json,platform,sys,tarfile
from pathlib import Path
assets,dest=map(Path,sys.argv[1:])
m=json.loads((assets/'atlas-release.json').read_text())
host_arch={'x86_64':'amd64','amd64':'amd64','aarch64':'arm64','arm64':'arm64'}.get(platform.machine())
if platform.system()!='Linux' or host_arch is None:
    raise SystemExit('Installation requires Linux amd64 or arm64; detected '+platform.system()+' '+platform.machine())
if m.get('architecture')!=host_arch:
    raise SystemExit('Architecture mismatch: host is '+host_arch+', release is '+str(m.get('architecture')))
for name in ('atlas.py', m['chart']):
    if hashlib.sha256((assets/name).read_bytes()).hexdigest()!=m['archives'][name]:
        raise SystemExit('Installer/chart checksum mismatch')
with tarfile.open(assets/m['chart']) as bundle:
    for member in bundle.getmembers():
        if not (dest/member.name).resolve().is_relative_to(dest.resolve()) or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe chart archive')
    bundle.extractall(dest)
PY
python3 "$ATLAS_ASSETS/atlas.py" install --assets "$ATLAS_ASSETS" --chart "$ATLAS_CHART_DIR/atlas-mvp" "$@"
