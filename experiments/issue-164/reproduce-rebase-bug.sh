#!/usr/bin/env bash
# Reproduces "cannot rebase: Your index contains uncommitted changes" from the
# Rust release workflow (rust/scripts/version-and-commit.rs).
#
# The failure is purely local: the script modifies + `git add`s the version
# files (dirty index) and only THEN runs `git rebase origin/main`. git refuses
# to rebase with a dirty index. Pass "fixed" to run the corrected order
# (rebase while the tree is still clean, before staging).
set -eu
mode="${1:-buggy}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
git init -q .
git config user.email a@b.c; git config user.name a
git checkout -q -b main

printf 'version = "0.9.5"\n' > Cargo.toml
git add Cargo.toml; git commit -qm "A: initial"

# Simulate origin/main advancing on a parallel ref (commit B)
git checkout -q -b origin-main
echo remote-change > other.txt
git add other.txt; git commit -qm "B: remote advanced"
git checkout -q main   # release copy stays at commit A, behind origin-main

rebase_if_behind() {
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin-main)" ]; then
    echo "Local branch is behind remote, rebasing..."
    git rebase origin-main
  fi
}

if [ "$mode" = fixed ]; then
  rebase_if_behind                       # rebase first, clean tree
  printf 'version = "0.9.6"\n' > Cargo.toml
  git add Cargo.toml
else
  printf 'version = "0.9.6"\n' > Cargo.toml
  git add Cargo.toml                     # stage -> dirty index
  rebase_if_behind                       # then rebase -> FAILS
fi

git commit -qm "release 0.9.6"
echo "RESULT[$mode]: success, version=$(grep version Cargo.toml)"
