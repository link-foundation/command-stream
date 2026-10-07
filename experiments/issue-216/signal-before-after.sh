#!/usr/bin/env bash
# Compare the graceful-termination tests before and after the issue-216 fix
# while bounded CPU-bound load competes for the scheduler.
# Usage: signal-before-after.sh <before-test-file> <after-test-file> [iterations] [load]
set -u
BEFORE=$1; AFTER=$2; ITERATIONS=${3:-20}
LOAD=${4:-$(( $(nproc) * 16 ))}
pids=()
for _ in $(seq "$LOAD"); do timeout 600 sh -c 'while :; do :; done' & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
for label in before after; do
  file=$BEFORE; [ "$label" = after ] && file=$AFTER
  fail=0
  for i in $(seq "$ITERATIONS"); do
    if ! out=$(timeout 120 bun test "$file" -t 'graceful termination' 2>&1); then
      fail=$((fail + 1))
      echo "$label iteration $i:"; echo "$out" | grep -E '\(fail\)' | head -3
    fi
  done
  echo "$label: $fail / $ITERATIONS runs failed (load processes: $LOAD)"
done
