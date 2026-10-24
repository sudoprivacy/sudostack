#!/usr/bin/env python3
"""Install producer-prepared configuration bytes under an exclusive product owner.

This is file selection only. It does not restart services or claim application
readiness. The product adapter must exclude independent configuration writers;
the cooperative deployment lock is not a filesystem compare-and-swap primitive.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile

from cohost import digest, private_directory, publish
from checkpoint import owned_path


def replace_configuration(path, expected, prepared, candidate_hash, evidence, execute=False):
    path, prepared, evidence = (owned_path(str(value)) for value in (path, prepared, evidence))
    if not all(re.fullmatch('[a-f0-9]{64}', value) for value in (expected, candidate_hash)):
        raise ValueError('Full old and prepared configuration hashes are required')
    if path == prepared or evidence in (path, prepared) or evidence.exists():
        raise ValueError('Use distinct configuration inputs and a new evidence directory')
    if not path.is_file() or not prepared.is_file():
        raise ValueError('Existing and producer-prepared regular files are required')
    if digest(path) != expected or digest(prepared) != candidate_hash:
        raise ValueError('Configuration pin changed; inspect again')
    report = {'schemaVersion':1, 'action':'deploy.configuration', 'status':'inspected',
              'oldSha256':expected, 'preparedSha256':candidate_hash,
              'serviceRestarted':False, 'authenticatedReady':False,
              'exclusiveConfigurationOwnerRequired':True}
    if not execute:
        return report
    private_directory(evidence.parent)
    with (evidence.parent/'.configuration.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if evidence.exists() or digest(path) != expected or digest(prepared) != candidate_hash:
            raise ValueError('Configuration/evidence changed before serialization')
        private_directory(path.parent)
        original = path.stat()
        evidence.mkdir(mode=0o700)
        # Publish old bytes before changing selection. Never restore these over
        # later accepted writes automatically; the native product owns rollback.
        publish(evidence/'original', path.read_bytes(), 0o600)
        descriptor, name = tempfile.mkstemp(prefix='.'+path.name+'.deploy-', dir=path.parent)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(prepared.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
            current = path.lstat()
            if (current.st_dev,current.st_ino) != (original.st_dev,original.st_ino) or digest(path) != expected:
                raise ValueError('Configuration changed during preparation')
            if digest(temporary) != candidate_hash:
                raise ValueError('Prepared file changed during preparation')
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            report['status'] = 'configuration-installed-for-next-start'
        finally:
            temporary.unlink(missing_ok=True)
        publish(evidence/'receipt.json', (json.dumps(report,indent=2)+'\n').encode(), 0o600)
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect','apply'])
    parser.add_argument('--path', type=Path, required=True)
    parser.add_argument('--expected', required=True)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(replace_configuration(args.path,args.expected,args.prepared,args.sha256,args.evidence,args.command=='apply'),indent=2))
