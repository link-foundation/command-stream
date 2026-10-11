## Summary

`scripts/validate_changeset.py` collects the added fragments with `git diff --name-only --find-renames --diff-filter=A`. With the default 50 % similarity threshold, a PR that deletes a pending fragment and adds a new one has the pair reported as a rename (`R066`), because fragments are mostly frontmatter. `--diff-filter=A` then drops the new fragment, and the check fails with "no fragment" even though the PR adds one.

The source-path list already uses `--no-renames`, which is correct. This report is only about the additions list.

Found while fixing the same logic in link-foundation/command-stream ([issue #216](https://github.com/link-foundation/command-stream/issues/216), [PR #217](https://github.com/link-foundation/command-stream/pull/217)).

## Where (at `1e929ef`)

[`scripts/validate_changeset.py#L114-L135`](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/blob/1e929ef857debdd290a90bfdafac1bae3ed8cd50/scripts/validate_changeset.py#L114-L135):

```python
options = ("--find-renames", "--diff-filter=A") if additions else ("--no-renames",)
```

## Reproduction (git only, throwaway repository)

[`rename-detection-repro.sh`](https://github.com/link-foundation/command-stream/blob/issue-216-fe6e9f11097a/experiments/issue-216/rename-detection-repro.sh):

```
--find-renames (python template validate_changeset.py additions):
  replaced  added fragments:
  moved     added fragments:
```

Expected: `replaced` lists `changelog.d/new.md` (a different fragment text with the same frontmatter). `moved` (an unchanged `git mv` of a pending fragment) correctly lists nothing.

## Workaround / suggested fix

Use `--find-renames=100%` for the additions list. Only byte-identical moves are then paired, so the moved case keeps the behaviour that `--find-renames` was chosen for, and the replaced case is fixed:

```
--find-renames=100%:
  replaced  added fragments: changelog.d/new.md
  moved     added fragments:
```

command-stream applied the same option in [PR #217](https://github.com/link-foundation/command-stream/pull/217) (`js/scripts/validate-changeset.mjs`, `rust/scripts/check-changelog-fragment.rs`).
