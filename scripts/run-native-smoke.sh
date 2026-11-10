#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
exec flock /tmp/openclast-local-verification.lock build-contained -- bash -c '
  set -euo pipefail
  bun install --frozen-lockfile --ignore-scripts
  bun run fixture --small
  bun run build
  bun run e2e
'
