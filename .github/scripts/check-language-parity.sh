#!/usr/bin/env bash
#
# Language parity check.
#
# command-stream ships two implementations that must stay in lock-step. Source
# changes and benchmark changes are checked independently, so a token benchmark
# edit cannot satisfy a behavioral source change (or vice versa). This keeps
# both the implementation and its measured claims available in both languages.
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

js_source_changed=false
rust_source_changed=false
js_benchmarks_changed=false
rust_benchmarks_changed=false
while IFS= read -r f; do
  [ -z "${f}" ] && continue
  case "${f}" in
    js/src/*) js_source_changed=true ;;
    rust/src/*) rust_source_changed=true ;;
    js/benchmarks/* | js/tests/benchmark-*) js_benchmarks_changed=true ;;
    rust/benchmarks/Cargo.lock) ;;
    rust/benchmarks/*) rust_benchmarks_changed=true ;;
  esac
done <<EOF
${CHANGED}
EOF

echo "js/src changed:          ${js_source_changed}"
echo "rust/src changed:        ${rust_source_changed}"
echo "js benchmarks changed:   ${js_benchmarks_changed}"
echo "rust benchmarks changed: ${rust_benchmarks_changed}"

check_pair() {
  local js_changed="$1"
  local rust_changed="$2"
  local js_scope="$3"
  local rust_scope="$4"
  local category="$5"

  if [ "${js_changed}" = "true" ] && [ "${rust_changed}" != "true" ]; then
    echo "::error::JavaScript ${category} (${js_scope}) changed but Rust ${category} (${rust_scope}) did not."
    echo "command-stream keeps the JavaScript and Rust implementations in parity."
    echo "Please make the equivalent change under ${rust_scope}, or add the"
    echo "'parity-exempt' label to this PR if the change is intentionally JavaScript-only."
    exit 1
  fi

  if [ "${rust_changed}" = "true" ] && [ "${js_changed}" != "true" ]; then
    echo "::error::Rust ${category} (${rust_scope}) changed but JavaScript ${category} (${js_scope}) did not."
    echo "command-stream keeps the JavaScript and Rust implementations in parity."
    echo "Please make the equivalent change under ${js_scope}, or add the"
    echo "'parity-exempt' label to this PR if the change is intentionally Rust-only."
    exit 1
  fi
}

check_pair \
  "${js_source_changed}" \
  "${rust_source_changed}" \
  'js/src/**' \
  'rust/src/**' \
  'source'
check_pair \
  "${js_benchmarks_changed}" \
  "${rust_benchmarks_changed}" \
  'js/benchmarks/** or js/tests/benchmark-*' \
  'rust/benchmarks/**' \
  'benchmarks'

echo "Language parity check passed."
