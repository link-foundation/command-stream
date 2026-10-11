#!/usr/bin/env bash
# Run two prebuilt Rust signal test binaries repeatedly under bounded CPU load.
# Usage: rust-signals-before-after.sh <before-binary> <after-binary> [iterations] [load]
set -u
BEFORE=$1; AFTER=$2; ITERATIONS=${3:-15}; LOAD=${4:-96}
pids=()
for _ in $(seq "$LOAD"); do timeout 600 sh -c 'while :; do :; done' & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
for label in before after; do
  binary=$BEFORE; [ "$label" = after ] && binary=$AFTER
  fail=0
  for i in $(seq "$ITERATIONS"); do
    if ! out=$(timeout 120 "$binary" 2>&1); then
      fail=$((fail + 1))
      echo "$label iteration $i:"; echo "$out" | grep -E 'FAILED|panicked' | head -4
    fi
  done
  echo "$label: $fail / $ITERATIONS runs failed (load processes: $LOAD)"
done
