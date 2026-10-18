#!/bin/sh
# Starts as root only to make the data volume writable, then runs the server as `node`.
# Brimble mounts its persistent disk root-owned, so a container that starts as `node`
# can't create /app/data/drops (EACCES at boot).
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR" 2>/dev/null || true

if setpriv --reuid=node --regid=node --init-groups test -w "$DATA_DIR"; then
	exec setpriv --reuid=node --regid=node --init-groups node --import tsx src/server.ts
fi

# Some volumes refuse chown (e.g. root-squashed network storage). Better to run as root
# than not at all; the log line makes it visible.
echo '{"level":"warn","event":"startup.running_as_root","note":"data dir not writable by node after chown"}'
exec node --import tsx src/server.ts
