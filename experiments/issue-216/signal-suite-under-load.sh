#!/usr/bin/env bash
# Run the whole signal-handling suite repeatedly under bounded CPU load.
# Usage: signal-suite-under-load.sh [iterations] [load]
set -u
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ITERATIONS=${1:-15}; LOAD=${2:-96}
pids=()
for _ in $(seq "$LOAD"); do timeout 600 sh -c 'while :; do :; done' & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
fail=0
for _ in $(seq "$ITERATIONS"); do
  out=$(timeout 120 bun test "$ROOT/js/tests/signal-handling.test.mjs" 2>&1) || {
    fail=$((fail + 1)); echo "$out" | grep -E '\(fail\)|Timed out' | head -3; }
done
echo "full suite: $fail / $ITERATIONS runs failed (load processes: $LOAD)"
