#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
if [[ $# -eq 0 ]]; then
  printf 'Usage: %s <install|build|test|licenses|fixture|project|e2e|bench|bench:browser> [arguments...]\n' "$0" >&2
  exit 2
fi
if [[ $1 == install ]]; then
  shift
  exec flock /tmp/obsidian-graph-ng-build.lock build-contained -- bun install "$@"
fi
exec flock /tmp/obsidian-graph-ng-build.lock build-contained -- bun run "$@"
