Found against template commit `4c8644fb457b65933fcb19b033e60e7d0338f2ad404` during [command-stream #209](https://github.com/link-foundation/command-stream/issues/209).

`validate-changeset.mjs` falls back to scanning the complete changeset directory after every Git comparison fails, including in CI. A valid fragment already on the base branch can satisfy a source-changing PR that added none.

Offline reproduction:

```bash
VALIDATE_CHANGESET_SCRIPT=/path/to/template/scripts/validate-changeset.mjs bun test js/tests/validate-changeset.test.mjs
```

[Fixture](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/js/tests/validate-changeset.test.mjs) creates package.json, one valid existing fragment, and a source-changing commit; `GITHUB_BASE_REF=missing` makes the comparison fail. Expected nonzero, actual zero. The same fixture also shows documentation-only changes require a fragment; this latter behavior should be an explicit policy choice. [Results](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/dev/log/issues/209/pulls/210/validation/template-changeset-before.log.gz).

Workaround: require a resolvable PR base before invoking validation; reject fallback directory scanning in CI.

Suggested fix: fail closed for unavailable refs, allow the directory fallback only for explicit local use, compare the merge base, and count only added fragments. Decide documentation-only exemptions from changed package paths. [Implementation](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/js/scripts/validate-changeset.mjs).
