Found while auditing [command-stream #209](https://github.com/link-foundation/command-stream/issues/209), against template commit `4c8644fb457b65933fcb19b033e60e7d0338f2ad404`.

`scripts/check-version.mjs` matches changed version lines instead of comparing parsed JSON values. Reindentation of the unchanged version fails; a failed Git comparison can pass as no version changes.

Reproduce offline with the three isolated Git cases in [check-version.test.mjs](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/js/tests/check-version.test.mjs):

```bash
CHECK_VERSION_SCRIPT=/path/to/template/scripts/check-version.mjs bun test js/tests/check-version.test.mjs
```

The fixture initializes a repository with package version 1.0.0, records origin/main, and commits either reformatting, version 2.0.0, or a missing-base comparison. The template fails 2/3 assertions: unchanged formatting should pass, and unavailable base should fail. [Captured results](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/dev/log/issues/209/pulls/210/validation/template-version-before.log.gz).

Workaround: run a separate guard that parses `git show <merge-base>:package.json` and the PR manifest, compares `.version`, and fails on all Git/JSON errors.

Suggested fix: use argument-array Git execution, `git merge-base`, JSON parsing of both manifests, and explicit failure for unavailable refs. Add these three cases and reject branch-name-based bypasses. [Working implementation](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/js/scripts/check-version.mjs).
