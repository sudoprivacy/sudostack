#!/usr/bin/env python3
"""Select Atlas assembly inputs; device actions have their own installed-bundle CI."""
import argparse
from pathlib import PurePosixPath

from artifacts import RUNTIME_SCRIPTS

ASSEMBLY_TOOLS = set(RUNTIME_SCRIPTS) | {
    'install-atlas.sh', 'install-cos.sh', 'release.py', 'package.py', 'cos_bundle.py',
    'bundle.py', 'prepare_publication.py', 'publish_cos.py', 'release_notes.py', 'release_docs.py',
    'nexus.Dockerfile',
}


def requires_assembly(paths):
    """Rebuild when component selection, chart or bundled/assembly bytes change."""
    for value in paths:
        path = PurePosixPath(value)
        if path.is_absolute() or '..' in path.parts or str(path) != value:
            raise ValueError('Expected repository-relative changed paths')
        if value.startswith(('manifests/deployment/', 'charts/atlas-mvp/')):
            return True
        if path.parent == PurePosixPath('tools/deploy') and path.name in ASSEMBLY_TOOLS:
            return True
    return False


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='*')
    arguments = parser.parse_args()
    print('true' if requires_assembly(arguments.paths) else 'false')
