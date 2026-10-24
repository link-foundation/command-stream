#!/usr/bin/env bash
# Supply the packed artifact followed by Node 22, 24 and 26 bin directories.
set -euo pipefail
archive="$(realpath "$1")"
shift
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
logs_directory="${ISSUE_221_LOG_DIRECTORY:-/tmp/issue-221-production-matrix}"
mkdir -p "$logs_directory"
status=0
for node_directory in "$@"; do
  node_version="$("$node_directory/node" --version)"
  for mode in scripts-enabled scripts-disabled omit-optional; do
    log_file="$logs_directory/$node_version-$mode.log"
    if bash "$script_directory/production-install.sh" "$archive" "$node_directory" "$mode" > "$log_file" 2>&1; then
      echo "PASS: $node_version $mode (local/global runtime and types)"
    else
      status=1
      echo "FAIL: $node_version $mode; see $log_file" >&2
    fi
  done
done
exit "$status"
