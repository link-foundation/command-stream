## Summary

`scripts/check-changelog-fragment.rs` and `scripts/detect-code-changes.rs` call `git diff --name-only` with git's default rename detection (`diff.renames=true` since git 2.9). That causes two wrong results on ordinary pull requests:

1. **False failure.** A PR changes code, deletes a pending fragment and adds a new one. A fragment is mostly frontmatter, so git pairs the two files as a rename (`R066`). `--diff-filter=A` then drops the new fragment, and the check reports "No changelog fragment found".
2. **False pass.** A PR moves `src/lib.rs` out of `src/` (for example to `examples/`). `--name-only` prints only the destination of a rename, so `src/lib.rs` never appears. No source file looks changed, so no fragment is required and the code jobs are skipped.

Found while fixing the same code in link-foundation/command-stream ([issue #216](https://github.com/link-foundation/command-stream/issues/216), [PR #217](https://github.com/link-foundation/command-stream/pull/217)), which started from this template.

## Where (at `d74660b`)

- [`scripts/check-changelog-fragment.rs#L79-L86`](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/blob/d74660b0ddcaa991ec9299892bfb353eee203d13/scripts/check-changelog-fragment.rs#L79-L86): `["diff", "--name-only", "-z", "origin/<base>...HEAD"]`, plus `--diff-filter=A` for the added-fragment list.
- [`scripts/detect-code-changes.rs#L118-L151`](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/blob/d74660b0ddcaa991ec9299892bfb353eee203d13/scripts/detect-code-changes.rs#L118-L151): `["diff", "--name-only", …]` for the changed-file list.

## Reproduction (git only, throwaway repository)

[`rename-detection-repro.sh`](https://github.com/link-foundation/command-stream/blob/issue-216-fe6e9f11097a/experiments/issue-216/rename-detection-repro.sh) builds three branches and prints what each diff option reports:

```
default rename detection (rust template check-changelog-fragment.rs, detect-code-changes.rs):
  replaced  added fragments:
  moved     added fragments:
  code-out  changed paths:   examples/lib.rs
```

Expected: `replaced` lists `changelog.d/new.md`, and `code-out` also lists `src/lib.rs`.

## Workaround / suggested fix

- **Added-fragment list:** add `--find-renames=100%`. Only byte-identical moves are then paired. A replaced fragment is `A`, and a pending fragment moved unchanged stays `R100`, which correctly does not count as new. Plain `--no-renames` would count that move as a new fragment.
- **Changed-file lists:** add `--no-renames`, so both sides of a move are listed.

With those options the same script prints:

```
  replaced  added fragments: changelog.d/new.md
  moved     added fragments:
  code-out  changed paths:   examples/lib.rs src/lib.rs
```

command-stream applied exactly this in [PR #217](https://github.com/link-foundation/command-stream/pull/217): `rust/scripts/check-changelog-fragment.rs` and `rust/scripts/detect-code-changes.rs`, with scenario tests in `experiments/issue-216/changelog-fragment-check.sh`.
