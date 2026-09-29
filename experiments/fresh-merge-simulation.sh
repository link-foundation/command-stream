#!/usr/bin/env bash
#
# Exercises .github/scripts/simulate-fresh-merge.sh in a throwaway repository.
#
# Three cases, each asserted:
#   1. the branch already contains every commit on the base -> no-op, exit 0
#   2. the base moved ahead with a compatible change        -> merged, exit 0,
#                                                              base file present
#   3. the base moved ahead with a conflicting change       -> exit 1 and an
#                                                              ::error:: annotation
#
# Usage: bash experiments/fresh-merge-simulation.sh
set -uo pipefail

script="$(cd "$(dirname "$0")/.." && pwd)/.github/scripts/simulate-fresh-merge.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
failures=0

check() { # check <description> <expected-exit> <actual-exit>
  if [ "$2" = "$3" ]; then
    echo "ok   - $1"
  else
    echo "FAIL - $1 (expected exit $2, got $3)"
    failures=$((failures + 1))
  fi
}

setup() { # setup <case> ; prints the clone path
  local name="$1"
  local origin="$root/$name-origin" clone="$root/$name"
  git init -q --bare -b main "$origin"
  git init -q -b main "$root/$name-seed"
  (
    cd "$root/$name-seed"
    git config user.email seed@example.com
    git config user.name Seed
    echo base > shared.txt
    git add shared.txt
    git commit -qm 'initial'
    git branch -M main
    git remote add origin "$origin"
    git push -q origin main
  )
  git clone -q "$origin" "$clone"
  (
    cd "$clone"
    git config user.email dev@example.com
    git config user.name Dev
    git checkout -qb feature
    echo feature > feature.txt
    git add feature.txt
    git commit -qm 'feature work'
  )
  echo "$clone"
}

advance_base() { # advance_base <case> <file> <content>
  local seed="$root/$1-seed"
  (
    cd "$seed"
    git checkout -q main
    echo "$3" > "$2"
    git add "$2"
    git commit -qm "base moves"
    git push -q origin main
  )
}

# 1. nothing to merge
clone="$(setup uptodate)"
out="$(cd "$clone" && BASE_REF=main bash "$script" 2>&1)"; status=$?
check 'up-to-date branch is a no-op' 0 "$status"
grep -q 'nothing to simulate' <<<"$out" || { echo "FAIL - expected the no-op message"; failures=$((failures + 1)); }

# 2. base moved ahead, no conflict
clone="$(setup clean)"
advance_base clean other.txt 'added on main'
out="$(cd "$clone" && BASE_REF=main bash "$script" 2>&1)"; status=$?
check 'a base commit is merged in' 0 "$status"
[ -f "$clone/other.txt" ] || { echo "FAIL - the base file is missing after the merge"; failures=$((failures + 1)); }

# 3. base moved ahead with a conflict
clone="$(setup conflict)"
(cd "$clone" && echo 'branch version' > shared.txt && git commit -qam 'branch edits shared.txt')
advance_base conflict shared.txt 'main version'
out="$(cd "$clone" && BASE_REF=main bash "$script" 2>&1)"; status=$?
check 'a conflicting base commit fails the job' 1 "$status"
grep -q '::error::Merge conflict' <<<"$out" || { echo "FAIL - expected an ::error:: annotation"; failures=$((failures + 1)); }

echo
if [ "$failures" -eq 0 ]; then
  echo 'All fresh-merge simulation cases behaved as expected.'
else
  echo "$failures case(s) failed."
fi
exit $((failures > 0))
