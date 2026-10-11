#!/usr/bin/env bash
# Probe issue 216 F2: run the graceful-signal tests repeatedly while bounded
# CPU-bound load competes for the scheduler, like a busy hosted macOS runner.
# Usage: signal-grace-race.sh [iterations] [load-processes]
set -u
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ITERATIONS=${1:-20}
LOAD=${2:-$(( $(nproc) * 2 ))}
cd "$ROOT/js"
pids=()
for _ in $(seq "$LOAD"); do timeout 600 sh -c 'while :; do :; done' & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
fail=0
for i in $(seq "$ITERATIONS"); do
  if ! out=$(timeout 60 bun test tests/signal-handling.test.mjs -t 'graceful termination' 2>&1); then
    fail=$((fail + 1))
    echo "iteration $i failed:"; echo "$out" | grep -E '\((fail|pass)\)|Expected|Received' | head -10
  fi
done
echo "failures: $fail / $ITERATIONS (load processes: $LOAD)"
