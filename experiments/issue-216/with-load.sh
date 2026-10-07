#!/usr/bin/env bash
# Run a command while N bounded CPU-bound processes compete for the scheduler.
# Usage: with-load.sh <load-processes> <command...>
set -u
LOAD=$1; shift
pids=()
for _ in $(seq "$LOAD"); do timeout 600 sh -c 'while :; do :; done' & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
"$@"
