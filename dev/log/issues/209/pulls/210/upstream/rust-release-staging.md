Observed while reviewing command-stream issue 209 / PR 210, against template revision `e7d4a5bceb152f76d9fde77bae6751b835b9cdcd162`.

The release writer stages named metadata files, but `git commit` also includes files already present in the index. Consequently an unrelated staged source/file change can enter a release commit. Explicit `git add` arguments alone do not restrict what the commit contains. Lines 1190 onward stage Cargo/changelog paths but do not validate the existing index or other modifications.

Offline reproduction (isolated temporary Git repository; no registry requests or pushes):

```bash
scratch=$(mktemp -d)
git -C "$scratch" init -q
git -C "$scratch" config user.name Test
git -C "$scratch" config user.email test@example.com
printf 'version = "1.4.0"\n' > "$scratch/Cargo.toml"
git -C "$scratch" add Cargo.toml
git -C "$scratch" commit -qm base
printf 'unrelated source change\n' > "$scratch/unrelated.txt"
git -C "$scratch" add unrelated.txt
printf 'version = "1.4.1"\n' > "$scratch/Cargo.toml"
git -C "$scratch" add Cargo.toml
git -C "$scratch" commit -qm release
git -C "$scratch" show --format= --name-only HEAD
# Actual: Cargo.toml AND unrelated.txt; expected: only release metadata.
rm -rf "$scratch"
```

Workaround: require a clean checkout/index before release generation, and inspect the complete staged diff before committing. A dirty checkout should fail rather than discard unrelated work.

Suggested fix: inspect NUL-delimited modified/deleted/untracked paths and `git diff --cached --name-only -z` across the repository. Reject anything outside the selected package's allowlist before staging. Permit Cargo.toml, Cargo.lock, CHANGELOG.md, consumed changelog.d/*.md fragments and this monorepo's benchmark Cargo.lock; handle standalone and nested package roots. Use native subprocess argument arrays rather than interpolated shell paths.

Permanent temporary-Git regressions and before/after logs are included in https://github.com/link-foundation/command-stream/pull/210: reject both already staged and untracked unrelated files, preserve other-language changes, and allow deleted fragments/benchmark lock metadata. No real package publication is needed to reproduce this problem.

The current template already creates release tags after push/rebase retries. That correct ordering was reused in command-stream rather than reporting the same fixed tag race upstream again.
