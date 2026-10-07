#!/usr/bin/env bash
# Run the old (HEAD~ of the fix) and current rust/scripts/check-changelog-fragment.rs
# against PR diffs that the release would mishandle (issue #216):
#   root   - fragment in a root changelog.d/, which the release never reads
#   nested - fragment in a subdirectory of rust/changelog.d/
#   typo   - fragment in the right place with `bump: majr`
#   good   - fragment in the right place with `bump: minor`
#   renamed - a new fragment added while an existing one is removed; git's
#            rename detection pairs them, so --diff-filter=A alone misses it
#   moved  - an existing fragment moved unchanged; not a new fragment, which
#            --no-renames alone would wrongly count as one
# Works in a throwaway clone; the repository itself is not modified.
# Usage: changelog-fragment-check.sh [old-revision]
set -uo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
OLD_REV=${1:-HEAD}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/scripts"
git -C "$ROOT" show "$OLD_REV:rust/scripts/check-changelog-fragment.rs" > "$WORK/scripts/old.rs"
cp "$ROOT/rust/scripts/check-changelog-fragment.rs" "$WORK/scripts/new.rs"
git clone --quiet --no-local "$ROOT" "$WORK/repo"
cd "$WORK/repo"
git checkout --quiet --detach
git update-ref refs/remotes/origin/main HEAD
for scenario in root nested typo good renamed moved; do
  git checkout --quiet --detach refs/remotes/origin/main
  echo "// probe" >> rust/src/lib.rs
  case $scenario in
    root) mkdir -p changelog.d && printf -- '---\nbump: patch\n---\n\n### Fixed\n- x\n' > changelog.d/20261007_probe.md ;;
    nested) mkdir -p rust/changelog.d/old && printf -- '---\nbump: patch\n---\n\n### Fixed\n- x\n' > rust/changelog.d/old/20261007_probe.md ;;
    typo) printf -- '---\nbump: majr\n---\n\n### Changed\n- x\n' > rust/changelog.d/20261007_probe.md ;;
    good) printf -- '---\nbump: minor\n---\n\n### Added\n- x\n' > rust/changelog.d/20261007_probe.md ;;
    renamed)
      existing=$(git ls-files 'rust/changelog.d/*.md' | grep -v README.md | head -1)
      sed 's/^- /- Again: /' "$existing" > rust/changelog.d/20261007_probe.md
      git rm --quiet "$existing" ;;
    moved)
      existing=$(git ls-files 'rust/changelog.d/*.md' | grep -v README.md | head -1)
      git mv "$existing" rust/changelog.d/20261007_probe.md ;;
  esac
  git add -A && git -c user.name=probe -c user.email=probe@example.invalid commit --quiet -m "$scenario"
  for version in old new; do
    out=$(GITHUB_BASE_REF=main rust-script "$WORK/scripts/$version.rs" 2>&1)
    echo "$scenario/$version: exit $?"
    echo "$out" | grep -E '::(error|warning)|Changelog check passed|fragments added:' | sed 's/^/    /'
  done
done
