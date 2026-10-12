#!/usr/bin/env bash
# How the "was a changelog fragment added?" and "did code change?" git diffs of
# command-stream and the three pipeline templates classify two pull requests
# (issue #216). Builds a throwaway repository; runs git only.
#
#   replaced - code changed; pending fragment old.md deleted and a new fragment
#              new.md added (same frontmatter, different text). Must count as
#              a new fragment.
#   moved    - code changed; pending fragment old.md moved unchanged to
#              moved.md. Must NOT count as a new fragment.
#   code-out - src/lib.rs moved unchanged to examples/lib.rs. Must count as a
#              source change (src/lib.rs disappeared).
set -euo pipefail
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init --quiet --initial-branch=main
git config user.name probe
git config user.email probe@example.invalid
mkdir changelog.d src examples
printf -- '---\nbump: patch\n---\n\n### Fixed\n\n- Fix a bug.\n' > changelog.d/old.md
printf 'pub fn a() {}\n' > src/lib.rs
git add . && git commit --quiet -m base

git checkout --quiet -b replaced main
git rm --quiet changelog.d/old.md && mkdir -p changelog.d
printf -- '---\nbump: patch\n---\n\n### Fixed\n\n- Fix another bug.\n' > changelog.d/new.md
echo '// change' >> src/lib.rs
git add . && git commit --quiet -m replaced

git checkout --quiet -b moved main
git mv changelog.d/old.md changelog.d/moved.md
echo '// change' >> src/lib.rs
git add . && git commit --quiet -m moved

git checkout --quiet -b code-out main
git mv src/lib.rs examples/lib.rs
git commit --quiet -m code-out

added() { # options... ; prints the fragments a --diff-filter=A style check sees
  for branch in replaced moved; do
    printf '  %-9s added fragments: %s\n' "$branch" \
      "$(git diff --name-only --diff-filter=A "$@" "main...$branch" -- changelog.d | tr '\n' ' ')"
  done
}
changed() { # options... ; prints the changed paths a --name-only check sees
  printf '  %-9s changed paths:   %s\n' code-out \
    "$(git diff --name-only "$@" main...code-out | tr '\n' ' ')"
}

echo "git $(git --version | cut -d' ' -f3)"
echo
echo "default rename detection (rust template check-changelog-fragment.rs, detect-code-changes.rs):"
added
changed
echo
echo "--find-renames (python template validate_changeset.py additions):"
added --find-renames
echo
echo "--no-renames (js template pr-comparison.mjs; python template source paths):"
added --no-renames
changed --no-renames
echo
echo "--find-renames=100% for additions, --no-renames for changed paths (command-stream #217):"
added --find-renames=100%
changed --no-renames
