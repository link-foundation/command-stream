#!/usr/bin/env bash
# Run the "Check Rust lockfiles have no compatible updates pending" step from
# .github/workflows/dependencies.yml in a throwaway worktree, first on the
# committed lockfiles (expect exit 0, no dry-run warning), then after pinning
# one crate to an older compatible version (expect exit 1 with the diff).
# Usage: cargo-lockfile-freshness.sh <crate> <older-compatible-version>
set -uo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
CRATE=${1:?crate}
OLDER=${2:?older version}
WORK=$(mktemp -d)
trap 'git -C "$ROOT" worktree remove --force "$WORK" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
git -C "$ROOT" worktree add --detach "$WORK" HEAD >/dev/null
cp "$ROOT/.github/workflows/dependencies.yml" "$WORK/.github/workflows/dependencies.yml"
cd "$WORK"
SCRIPT=$(python3 -I -c '
import sys
s = open(sys.argv[1]).read()
s = s.split("name: Check Rust lockfiles have no compatible updates pending\n")[1]
s = s.split("run: |\n")[1].split("\n\n")[0]
print("\n".join(line[10:] for line in s.split("\n")))
' .github/workflows/dependencies.yml)
echo "--- step on the committed lockfiles"
bash -c "$SCRIPT"
echo "exit $?"
git checkout -q -- rust
cargo update --manifest-path rust/Cargo.toml -p "$CRATE" --precise "$OLDER" 2>&1 | tail -3
git -c user.name=probe -c user.email=probe@example.invalid commit -q -am "stale $CRATE" || exit 3
echo "--- step with $CRATE pinned to $OLDER"
bash -c "$SCRIPT"
echo "exit $?"
