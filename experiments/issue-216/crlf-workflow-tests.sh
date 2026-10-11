#!/usr/bin/env bash
# Runs the workflow-text tests against a checkout whose workflow files and
# lychee.toml use CRLF, as a Windows runner's checkout does (issue #216).
# Usage: crlf-workflow-tests.sh <commit>
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'git -C "$repo" worktree remove --force "$work/tree"; rm -rf "$work"' EXIT
git -C "$repo" worktree add --quiet --detach "$work/tree" "${1:-HEAD}"
for f in "$work"/tree/.github/workflows/*.yml "$work/tree/lychee.toml"; do
  sed -i 's/\r\?$/\r/' "$f"
done
ln -s "$repo/js/node_modules" "$work/tree/js/node_modules"
cd "$work/tree/js"
bun test tests/workflow-hygiene.test.mjs tests/github-release-state.test.mjs 2>&1 |
  grep -E '^\(fail\)| pass$| fail$'
