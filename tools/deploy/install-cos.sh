#!/usr/bin/env bash
# Fetch one complete, pinned offline bundle from COS, then run its local installer.
set -euo pipefail
umask 077
ATLAS_RELEASE_TAG="${ATLAS_RELEASE_TAG:-@@ATLAS_RELEASE_TAG@@}"
ATLAS_COS_BASE="${ATLAS_COS_BASE:-https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack}"
ATLAS_DOWNLOAD_ONLY=0
ATLAS_INSTALL_ARGS=()
while (( $# )); do
  case "$1" in
    --download-only) ATLAS_DOWNLOAD_ONLY=1 ;;
    -h|--help)
      cat <<'HELP'
Usage: sudo bash install-cos.sh --host <IP-or-domain> --manage-k3s [installer options]
       ATLAS_CACHE_DIR=/path/to/cache bash install-cos.sh --download-only

All installation resources are downloaded from COS as one verified .tar.gz.
--download-only prepares local files without installing anything.
Environment: ATLAS_COS_BASE, ATLAS_CACHE_DIR, ATLAS_RELEASE_TAG (fixed suite tag).
Once prepared, run <cache>/<release>/assets/install-atlas.sh to install offline.
HELP
      exit 0 ;;
    *) ATLAS_INSTALL_ARGS+=("$1") ;;
  esac
  shift
done
[[ "$ATLAS_RELEASE_TAG" =~ ^sudostack-v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || {
  echo 'Use a published COS installer, or set a fixed ATLAS_RELEASE_TAG.' >&2; exit 1;
}
if (( ! ATLAS_DOWNLOAD_ONLY )); then
  [[ "$EUID" -eq 0 && "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
    echo 'Installation requires root on Linux x86_64.' >&2; exit 1;
  }
fi
for ATLAS_COMMAND in python3 curl flock; do
  command -v "$ATLAS_COMMAND" >/dev/null || { echo "$ATLAS_COMMAND is required" >&2; exit 1; }
done
ATLAS_COS_RELEASE_URL="${ATLAS_COS_BASE%/}/releases/$ATLAS_RELEASE_TAG"
ATLAS_COS_CACHE="${ATLAS_CACHE_DIR:-/var/cache/sudostack}/$ATLAS_RELEASE_TAG"
install -d -m 700 "$ATLAS_COS_CACHE/.cos-bootstrap"
exec 9>"$ATLAS_COS_CACHE/.download.lock"
flock 9
python3 - "$ATLAS_COS_RELEASE_URL" "$ATLAS_COS_CACHE/.cos-bootstrap" "$ATLAS_RELEASE_TAG" <<'PY'
import hashlib,json,re,subprocess,sys,tempfile
from pathlib import Path
from urllib.parse import urlparse
base,directory,tag=sys.argv[1],Path(sys.argv[2]),sys.argv[3]
url=urlparse(base)
if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment:
    raise SystemExit('ATLAS_COS_BASE must be an HTTPS URL without credentials, query or fragment')
def fetch(name,expected=None):
    target=directory/name
    if target.is_symlink():raise SystemExit('Unsafe bootstrap destination')
    if expected and target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==expected:return
    with tempfile.NamedTemporaryFile(dir=directory,delete=False) as output:temporary=Path(output.name)
    try:
        subprocess.run(['curl','--http1.1','-fsSL','--proto','=https','--proto-redir','=https',
            '--connect-timeout','20','--max-time','120','--retry','3','--retry-all-errors',base+'/'+name,'-o',str(temporary)],check=True)
        if expected and hashlib.sha256(temporary.read_bytes()).hexdigest()!=expected:raise SystemExit('COS bootstrap checksum mismatch')
        temporary.replace(target)
    finally:temporary.unlink(missing_ok=True)
fetch('bundle.json')
data=json.loads((directory/'bundle.json').read_text())
if data.get('schemaVersion')!=1 or data.get('release')!=tag:raise SystemExit('COS bundle release mismatch')
expected=data['files']['cos_bundle.py']['sha256']
if not re.fullmatch(r'[a-f0-9]{64}',expected):raise SystemExit('Invalid COS bootstrap checksum')
fetch('cos_bundle.py',expected)
PY
python3 "$ATLAS_COS_CACHE/.cos-bootstrap/cos_bundle.py" fetch \
  --descriptor "$ATLAS_COS_CACHE/.cos-bootstrap/bundle.json" \
  --base "$ATLAS_COS_RELEASE_URL" --cache "$ATLAS_COS_CACHE"
flock -u 9
if (( ATLAS_DOWNLOAD_ONLY )); then
  printf 'Offline installer: %s/assets/install-atlas.sh\n' "$ATLAS_COS_CACHE"
else
  exec bash "$ATLAS_COS_CACHE/assets/install-atlas.sh" "${ATLAS_INSTALL_ARGS[@]}"
fi
