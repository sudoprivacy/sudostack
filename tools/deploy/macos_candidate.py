#!/usr/bin/env python3
"""Stage a private macOS candidate from pinned component sources, without publishing."""
import argparse
import json
from pathlib import Path
import re
import subprocess

from artifacts import checksum, download


def committed(repository, commit, name):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('An exact source commit is required')
    return subprocess.check_output(['git', '-C', str(repository), 'show', f'{commit}:{name}'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile-repo', type=Path, required=True)
    parser.add_argument('--profile-commit', required=True)
    parser.add_argument('--scode-repo', type=Path, required=True)
    parser.add_argument('--stack-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    profile = 'profiles/personal-macos/'
    lock_bytes = committed(args.profile_repo, args.profile_commit, profile + 'bootstrap.lock.json')
    lock = json.loads(lock_bytes)
    if lock['schemaVersion'] != 1 or lock['qualification'] != 'candidate':
        raise ValueError('Only an explicitly unqualified candidate profile is supported')
    if lock['profile'] != 'personal-macos' or lock['setup']['repository'] != 'sudoprivacy/sudocode':
        raise ValueError('Expected the personal-macos profile and SudoCode setup owner')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', lock['scode']['version']):
        raise ValueError('An immutable SudoCode version is required')
    binary_pins = lock['scode'].get('binarySha256', {})
    if set(binary_pins) != {'macos-x64', 'macos-arm64'} or not all(
            re.fullmatch(r'[0-9a-f]{64}', value) for value in binary_pins.values()):
        raise ValueError('Both macOS executable SHA-256 pins are required; version text is insufficient')
    mirror = lock['scode']['mirror']
    if mirror != ('https://sudowork-release-1309794936.cos.ap-beijing.myqcloud.com/'
                  'sudocode/release/' + lock['scode']['version']):
        raise ValueError('The profile must select the versioned official release mirror')
    stack = Path(__file__).resolve().parents[2]
    files = {
        'macos-bootstrap.sh': committed(stack, args.stack_commit, 'tools/deploy/macos-bootstrap.sh'),
        'scode-setup.sh': committed(args.scode_repo, lock['setup']['commit'], 'packaging/macos/scode-setup.sh'),
        'Start.command': committed(args.profile_repo, args.profile_commit, profile + 'Start.command'),
        'PROFILE.md': committed(args.profile_repo, args.profile_commit, profile + 'README.md'),
        'bootstrap.lock.json': lock_bytes,
        'release.env': (f"SCODE_VERSION='{lock['scode']['version']}'\nSCODE_MIRROR='{mirror}'\n"
                        f"SCODE_SHA256_X64='{binary_pins['macos-x64']}'\n"
                        f"SCODE_SHA256_ARM64='{binary_pins['macos-arm64']}'\n").encode(),
    }
    # Refuse reuse: a failed staging directory remains evidence, never a valid release.
    args.output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        (args.output / name).write_bytes(data)
    download(mirror + '/install.sh', args.output / 'install.sh', lock['scode']['installerSha256'])
    provenance = {'qualification': 'candidate', 'deploymentVerified': False,
                  'profileCommit': args.profile_commit, 'stackCommit': args.stack_commit,
                  'setupCommit': lock['setup']['commit'], 'scodeVersion': lock['scode']['version']}
    provenance['scodeBinarySha256'] = binary_pins
    (args.output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8', newline='\n')
    names = sorted(path.name for path in args.output.iterdir())
    (args.output / 'SHA256SUMS').write_text(''.join(
        checksum(args.output / name) + '  ' + name + '\n' for name in names), encoding='utf-8', newline='\n')
    for name in [*names, 'SHA256SUMS']:
        (args.output / name).chmod(0o755 if name.endswith(('.sh', '.command')) else 0o600)
    print('Staged candidate only: ' + str(args.output))
    print('No signing, notarization, publication, Agent enrollment or deployment acceptance was performed.')


if __name__ == '__main__':
    main()
