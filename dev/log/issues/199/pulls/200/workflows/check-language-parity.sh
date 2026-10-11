#!/usr/bin/env bash
#
# Language parity check.
#
# command-stream ships two implementations that must stay in lock-step: the
# JavaScript library under js/src/** and the Rust library under rust/src/**.
# This script fails when a pull request changes one language's source without
# touching the other's, so that behavioral changes are always made in both
# languages (see issue #155 review feedback).
#
# Escape hatch: add the `parity-exempt` label to the PR for changes that are
# legitimately single-language (the workflow skips this check when the label is
# present).
#
# Environment:
#   BASE_REF  - the base branch to diff against (default: main). In GitHub
#               Actions this is github.base_ref.
#
# Usage (locally):
#   BASE_REF=main bash .github/scripts/check-language-parity.sh
set -euo pipefail

BASE_REF="${BASE_REF:-main}"

# Make sure the base branch is available locally, then resolve a ref we can diff
# against. Prefer the remote-tracking ref; fall back to the bare branch name.
git fetch --no-tags origin "${BASE_REF}" >/dev/null 2>&1 || true
if git rev-parse --verify --quiet "origin/${BASE_REF}" >/dev/null; then
  BASE="origin/${BASE_REF}"
elif git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  BASE="${BASE_REF}"
else
  echo "::warning::Could not resolve base ref '${BASE_REF}'; skipping parity check."
  exit 0
fi

MERGE_BASE="$(git merge-base "${BASE}" HEAD 2>/dev/null || echo "${BASE}")"
CHANGED="$(git diff --name-only "${MERGE_BASE}" HEAD)"

echo "Comparing against ${BASE} (merge-base ${MERGE_BASE})"
echo "Changed files:"
echo "${CHANGED}" | sed 's/^/  /'

js_changed=false
rust_changed=false
while IFS= read -r f; do
  [ -z "${f}" ] && continue
  case "${f}" in
    js/src/*) js_changed=true ;;
    rust/src/*) rust_changed=true ;;
  esac
done <<EOF
${CHANGED}
EOF

echo "js/src changed:   ${js_changed}"
echo "rust/src changed: ${rust_changed}"

if [ "${js_changed}" = "true" ] && [ "${rust_changed}" != "true" ]; then
  echo "::error::JavaScript source (js/src/**) changed but Rust source (rust/src/**) did not."
  echo "command-stream keeps the JavaScript and Rust implementations in parity."
  echo "Please make the equivalent change under rust/src/**, or add the"
  echo "'parity-exempt' label to this PR if the change is intentionally JS-only."
  exit 1
fi

if [ "${rust_changed}" = "true" ] && [ "${js_changed}" != "true" ]; then
  echo "::error::Rust source (rust/src/**) changed but JavaScript source (js/src/**) did not."
  echo "command-stream keeps the JavaScript and Rust implementations in parity."
  echo "Please make the equivalent change under js/src/**, or add the"
  echo "'parity-exempt' label to this PR if the change is intentionally Rust-only."
  exit 1
fi

echo "Language parity check passed."
