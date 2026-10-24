#!/usr/bin/env bash
# Reproduce issue 216: `changeset version` on a hosted runner without Deno.
# Usage: reproduce-changeset-version.sh <commit> [format-override]
# Creates a throwaway worktree, hides `deno` from PATH like the release job,
# runs the same changeset version command and prints the resulting diff.
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
COMMIT=${1:-HEAD}
OVERRIDE=${2:-}
WORK=$(mktemp -d)
trap 'git -C "$ROOT" worktree remove --force "$WORK" >/dev/null 2>&1 || true' EXIT
git -C "$ROOT" worktree add --detach "$WORK" "$COMMIT" >/dev/null
cd "$WORK/js"
cp -r "$ROOT/js/node_modules" node_modules
if [ -n "$OVERRIDE" ]; then
  node -e 'const f=".changeset/config.json";const c=JSON.parse(require("fs").readFileSync(f));c.format=JSON.parse(process.argv[1]);require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "$OVERRIDE"
fi
echo "config.format = $(node -p 'JSON.stringify(require("./.changeset/config.json").format ?? "(unset: auto)")')"
# The hosted ubuntu-24.04 image has no deno; remove every directory providing it.
CLEAN_PATH=$(echo "$PATH" | tr ':' '\n' | while read -r d; do [ -x "$d/deno" ] || echo "$d"; done | paste -sd: -)
echo "deno on PATH: $(PATH=$CLEAN_PATH command -v deno || echo none)"
set +e
PATH=$CLEAN_PATH node_modules/.bin/changeset version
STATUS=$?
set -e
echo "changeset version exit status: $STATUS"
git status --short
git diff --stat
git diff -- CHANGELOG.md | head -40
exit $STATUS
