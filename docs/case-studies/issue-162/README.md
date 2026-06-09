# Issue 162 Case Study: split release jobs skipped after PR 161

Issue: https://github.com/link-foundation/command-stream/issues/162

Pull request under repair: https://github.com/link-foundation/command-stream/pull/163

## Summary

Pull request 161 split the combined release workflow into separate JavaScript and
Rust workflows, but the first post-merge runs did not publish new language
artifacts. Both workflows reported `success`, while their release jobs were
skipped:

- JavaScript run
  https://github.com/link-foundation/command-stream/actions/runs/27144502569
  skipped `Release JavaScript package` at `2026-06-08T14:27:22Z`.
- Rust run
  https://github.com/link-foundation/command-stream/actions/runs/27144502471
  skipped `Release Rust crate` at `2026-06-08T14:29:08Z`.

The root cause was GitHub Actions skipped-needs propagation. The release jobs
depended on checks that themselves depended on PR-only gate jobs. Those gate
jobs are skipped on `push`, and the release jobs had plain job-level `if`
conditions without an explicit status-check function. GitHub therefore applied
the default success gate and skipped the downstream release jobs before their
conditions could produce the intended result.

## Evidence

Raw evidence is stored in [data](./data/), including the issue/PR JSON, action
run JSON, downloaded logs, package registry snapshots, and before/after test
output. Template snapshots are stored in [templates](./templates/).

Key files:

- [run-27144502569-js.json](./data/run-27144502569-js.json) - JavaScript
  post-merge run, including skipped release job.
- [run-27144502471-rust.json](./data/run-27144502471-rust.json) - Rust
  post-merge run, including skipped release job.
- [npm-command-stream.json](./data/npm-command-stream.json) - npm showed
  `command-stream@0.9.5`, last modified at `2026-06-08T12:31:06.021Z`.
- [crates-command-stream.json](./data/crates-command-stream.json) - crates.io
  showed `command-stream@0.9.5`, updated at
  `2026-06-08T12:31:20.216230Z`.
- [github-releases.txt](./data/github-releases.txt) - GitHub releases showed
  only `v0.9.5` after PR 161, not `js-v...` or `rust-v...` language tags.
- [workflow-policy-before.log](./data/workflow-policy-before.log) - the new
  policy test failing against the pre-fix workflow condition.
- [workflow-policy-after.log](./data/workflow-policy-after.log) - the same
  policy test passing after the workflow fix.

## Timeline

- `2026-06-08T12:31:22Z`: the old combined release workflow published GitHub
  release `v0.9.5`.
- `2026-06-08T14:25:57Z`: PR 161 merged as
  `c84031dec59ab29d7199c0685c980d7e10532bc7`.
- `2026-06-08T14:26:02Z`: the new Rust workflow started on the merge commit.
- `2026-06-08T14:26:03Z`: the new JavaScript workflow started on the merge
  commit.
- `2026-06-08T14:27:22Z`: the JavaScript release job was skipped while lint
  and test had succeeded.
- `2026-06-08T14:29:08Z`: the Rust release job was skipped while lint, test,
  and build had succeeded.
- After those runs, npm, crates.io, and GitHub Releases still reflected only
  version `0.9.5`/`v0.9.5`.

## Root Cause

The JavaScript workflow had this graph:

- `changeset-check`: PR-only, skipped on `push`.
- `lint` and `test`: depend on `changeset-check`, but use `always()` so they
  run on `push`.
- `release`: depends on `lint` and `test`, but had a plain condition:
  `github.ref == 'refs/heads/main' && github.event_name == 'push' && ...`.

The Rust workflow had the same shape:

- `changelog`: PR-only, skipped on `push`.
- `lint` and `test`: depend on `changelog`, but use `always()` so they run on
  `push`.
- `build`: already used `always() && !cancelled()`.
- `release`: depends on `lint`, `test`, and `build`, but had a plain condition.

GitHub documents that jobs depending on failed or skipped jobs are skipped
unless their condition explicitly continues evaluation. GitHub also documents
status-check functions such as `always()`, `success()`, and `cancelled()`.
Those references are:

- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds
- https://docs.github.com/en/actions/reference/evaluate-expressions-in-workflows-and-actions#status-check-functions

## Fix

Both release jobs now start with an explicit status-check guard and then verify
that the required checks succeeded:

```yaml
if: |
  always() && !cancelled() &&
  github.ref == 'refs/heads/main' &&
  github.event_name == 'push' &&
  needs.lint.result == 'success' &&
  needs.test.result == 'success'
```

The Rust job also checks `needs.build.result == 'success'`.

A repository-layout policy test now asserts that both language release jobs keep
this guard. That test failed against the original PR 161 workflow condition and
passes with the fix.

Patch release markers were added for both packages so the next merge to `main`
has release input to consume:

- [release-job-skipped-by-gate.md](../../../js/.changeset/release-job-skipped-by-gate.md)
- [20260608_issue_162_release_job_skip.md](../../../rust/changelog.d/20260608_issue_162_release_job_skip.md)

## Template Comparison

The template comparison used fresh snapshots saved under
[templates](./templates/).

| Template   | Snapshot                                   | Finding                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript | `2d77e242d1a1778b6fc7f3ca563b2a36ef555d0e` | Automatic release already has a status-check function (`!cancelled()`) and comments explaining the transitive skipped changeset dependency.                                                                                                                     |
| Rust       | `e18dfdcfbab0240f5d168036fc4116ccd190f964` | Automatic and manual release paths already use `always() && !cancelled()` for skipped dependency propagation.                                                                                                                                                   |
| C#         | `6872708aa3da13d5a67338cc8350c610c3af2275` | Automatic release uses `always()`, but the manual instant release path can still be skipped after `workflow_dispatch` skips `detect-changes`. Reported upstream as https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template/issues/23. |
| Python     | `66abe798182316d568e748bec4b0e89828fac1a6` | Manual release can be skipped after `workflow_dispatch` skips `detect-changes`. Reported upstream as https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/18.                                                               |

Existing issue searches for the Python and C# template risks returned no
matches before creating those reports:

- [python-template-existing-skipped-dependency-issues.json](./data/python-template-existing-skipped-dependency-issues.json)
- [csharp-template-existing-skipped-dependency-issues.json](./data/csharp-template-existing-skipped-dependency-issues.json)

## Verification

Local verification:

```sh
bun test js/tests/repository-layout.test.mjs --timeout 10000
cd js && bun run format:check
cd js && bun run lint
cd js && bun run check:duplication
cd js && PATH=/tmp/issue-162-bin:$PATH bun run test
```

The before/after and final validation logs are saved in:

- [workflow-policy-before.log](./data/workflow-policy-before.log)
- [workflow-policy-after.log](./data/workflow-policy-after.log)
- [workflow-policy-final.log](./data/workflow-policy-final.log)
- [workflow-yaml-parse.log](./data/workflow-yaml-parse.log)
- [js-format-check.log](./data/js-format-check.log)
- [js-lint.log](./data/js-lint.log)
- [js-duplication.log](./data/js-duplication.log)
- [js-test.log](./data/js-test.log)

The container did not have `jq`, and passwordless sudo was unavailable, so the
full JS test run used a temporary uncommitted `jq-1.7.1` binary under
`/tmp/issue-162-bin`. The download and version evidence are saved in:

- [jq-download.log](./data/jq-download.log)
- [jq-version.log](./data/jq-version.log)

The fix does not add default-on tracing. The downloaded action run JSON and logs
were enough to identify the skipped job graph and prove the workflow-level root
cause.
