#!/bin/sh
set -eu
DATA_DIR="${HISAAB_DATA_DIR:-/var/data}"
mkdir -p "$DATA_DIR"
chown -R hisaab:hisaab "$DATA_DIR"
exec setpriv --reuid=hisaab --regid=hisaab --init-groups "$@"
