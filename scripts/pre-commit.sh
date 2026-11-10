#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# Scan both index and worktree; gates never rewrite the index.
exec flock /tmp/openclast-local-verification.lock build-contained -- bun run gates:fast
