#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SOURCE="$ROOT_DIR/scripts/hooks/pre-commit"
HOOK_TARGET="$ROOT_DIR/.git/hooks/pre-commit"

if [ ! -x "$(command -v gitleaks)" ]; then
  echo "error: gitleaks is not installed. Install it first, then re-run bootstrap."
  exit 1
fi

bun install

mkdir -p "$(dirname "$HOOK_TARGET")"
cp "$HOOK_SOURCE" "$HOOK_TARGET"
chmod 755 "$HOOK_TARGET"

echo "Bootstrap complete."
echo "Installed pre-commit hook at $HOOK_TARGET"
