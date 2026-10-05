#!/bin/sh
# A child that handles SIGTERM gracefully: it traps the signal, writes a marker
# file proving the handler ran, and exits. Used to check whether
# command-stream's kill() actually gives the child a chance to clean up.
marker="$1"
trap 'echo "SIGTERM handler ran" >> "$marker"; exit 0' TERM
trap 'echo "SIGINT handler ran" >> "$marker"; exit 0' INT
echo ready
while true; do
  sleep 0.05
done
