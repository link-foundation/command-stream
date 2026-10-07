## Summary

`scripts/validate-changeset.mjs` takes its added changesets from `getPrChanges()` in `scripts/pr-comparison.mjs`, which runs `git diff --name-status -z --no-renames`. With `--no-renames`, a PR that only moves an existing pending changeset unchanged (`git mv .changeset/old.md .changeset/new-name.md`) reports the destination as `A`. That counts as a newly added changeset, so a code change with no new changeset passes the check.

The opposite choice, default rename detection, is also wrong: a deleted pending changeset plus a genuinely new one share most of their bytes (the frontmatter), so they are paired as `R` and the new one is missed. The Rust and Python templates have that variant. `--find-renames=100%` handles both cases.

Found while fixing the same logic in link-foundation/command-stream ([issue #216](https://github.com/link-foundation/command-stream/issues/216), [PR #217](https://github.com/link-foundation/command-stream/pull/217)). That PR first switched to `--no-renames` and then caught this case with a test.

## Where (at `1e43fdb`)

- [`scripts/pr-comparison.mjs#L39-L53`](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/blob/1e43fdb4fb26d69376b8663674c170212eb01765/scripts/pr-comparison.mjs#L39-L53): `--no-renames`.
- [`scripts/validate-changeset.mjs#L72-L80`](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/blob/1e43fdb4fb26d69376b8663674c170212eb01765/scripts/validate-changeset.mjs#L72-L80): `change.status === 'A'`.

## Reproduction (git only, throwaway repository)

[`rename-detection-repro.sh`](https://github.com/link-foundation/command-stream/blob/issue-216-fe6e9f11097a/experiments/issue-216/rename-detection-repro.sh):

```
--no-renames (js template pr-comparison.mjs; python template source paths):
  replaced  added fragments: changelog.d/new.md
  moved     added fragments: changelog.d/moved.md
```

Expected: `moved` lists nothing, because no new changeset was written.

## Workaround / suggested fix

Keep `--no-renames` for the paths used to decide whether a changeset is required, since both sides of a move matter there. For the `status === 'A'` list, run the diff with `--find-renames=100%`. Alternatively, read both path columns of `R` entries and treat only non-`R100` additions as new.

```
--find-renames=100%:
  replaced  added fragments: changelog.d/new.md
  moved     added fragments:
```

command-stream's version ([PR #217](https://github.com/link-foundation/command-stream/pull/217), `js/scripts/validate-changeset.mjs`) runs one `--name-status --find-renames=100%` diff. It takes both path columns of every entry for the code-change test, and only `A` entries as added changesets. It has a regression test, "moving a pending changeset does not add one".
