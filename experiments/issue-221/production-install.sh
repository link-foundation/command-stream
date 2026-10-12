#!/usr/bin/env bash
# Reuse the CI consumer checks locally when containers cannot start. PATH holds
# the selected Node distribution and ordinary tools, but excludes build tools.
set -euo pipefail
archive="$(realpath "$1")"
node_directory="$(realpath "$2")"
mode="${3:-omit-optional}"
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
tools_directory="$(mktemp -d)"
trap 'rm -rf "$tools_directory"' EXIT
for command_name in bash sh dirname realpath mktemp rm mkdir cp ln test printf sed head cat uname which env grep cut chmod touch; do
  command_path="$(command -v "$command_name")"
  if [ -f "$command_path" ]; then
    ln -s "$command_path" "$tools_directory/$command_name"
  fi
done
PATH="$node_directory:$tools_directory" bash "$root/js/scripts/test-production-install.sh" "$archive" "$mode"
