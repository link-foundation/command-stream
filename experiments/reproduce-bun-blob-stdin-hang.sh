#!/usr/bin/env bash
# Run the full Bun oracle corpus so the pipe-outlives-process cases face the
# same concurrency as the CI job. Logs stay in ci-logs/ for inspection.
set -u
mkdir -p ci-logs
for attempt in $(seq 1 "${1:-3}"); do
  log="ci-logs/bun-oracle-attempt-${attempt}.log"
  bun conformance/bun-shell/run-bun-reference.mjs > "$log" 2>&1
  status=$?
  printf 'attempt %s: exit %s\n' "$attempt" "$status"
  rg '^(FAIL|Total)' "$log" || true
done
