#!/usr/bin/env bash
# Explicit opt-in only. Never overwrite an existing hook or custom hooksPath.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
if [[ -n $(git config --get core.hooksPath || true) ]]; then
  echo 'Refusing custom core.hooksPath; integrate scripts/pre-commit.sh yourself.' >&2
  exit 1
fi
hook=$(git rev-parse --git-path hooks/pre-commit)
if [[ -e $hook ]]; then
  if cmp -s scripts/pre-commit.sh "$hook"; then echo 'Hook already installed.'; exit 0; fi
  echo 'Existing pre-commit hook retained; integrate scripts/pre-commit.sh yourself.' >&2
  exit 1
fi
mkdir -p "$(dirname "$hook")"
cp scripts/pre-commit.sh "$hook"
chmod +x "$hook"
echo 'Installed local pre-commit fast gates. Uninstall by removing this hook only.'
