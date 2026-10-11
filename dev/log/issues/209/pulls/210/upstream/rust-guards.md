Found against template commit `e7d4a5bceb152f76d9fde77bae6751b835b9cdcd162` during [command-stream #209](https://github.com/link-foundation/command-stream/issues/209).

Three isolated Git regressions reproduce:

1. `GITHUB_HEAD_REF=release/test` bypasses the manual version guard, even for a PR changing 1.0.0 to 2.0.0.
2. Indenting the unchanged Cargo.toml version line fails the line-based version guard.
3. Editing `changelog.d/existing.md` already present on main satisfies the changelog requirement for new source code, without adding a fragment.

```bash
RUST_GUARD_SCRIPTS=/path/to/template/scripts python3 experiments/issue-209/check-rust-guards.py
```

[Offline fixture](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/experiments/issue-209/check-rust-guards.py) uses a local bare origin, so fetches stay offline. [Results](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/dev/log/issues/209/pulls/210/validation/template-rust-guards-before.log.gz): 3 failures, 2 passes. Missing-base cases already fail correctly in this pinned template and are not claimed as template defects.

Workarounds: disallow branch-prefix exemptions, compare parsed `[package].version`, and require `git diff --diff-filter=A --name-only <merge-base> HEAD -- changelog.d` to include a new fragment.

Suggested fixes: apply these checks in `check-version-modification.rs` and `check-changelog-fragment.rs`, using a TOML parser and explicit error handling. Preserve workspace path detection. The corresponding command-stream implementations and all five passing regressions are in [PR 210](https://github.com/link-foundation/command-stream/pull/210).
