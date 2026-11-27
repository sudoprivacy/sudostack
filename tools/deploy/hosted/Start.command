#!/bin/bash
# Double-click entry on macOS: opens Terminal and runs the bootstrap wizard.
cd "$(dirname "$0")"
exec /bin/sh ./start.sh "$@"
