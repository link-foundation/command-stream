# CI follow-up plan

Objective: complete issue #235 and PR #236, including every CI gate.

- [x] Read the issue, all issue comments, PR conversation, inline comments and reviews.
- [x] Inventory original acceptance criteria in README.md; no required sub-issues.
- [x] Fetch the latest default branch and verify it is already an ancestor of HEAD.
- [x] Match failing workflow to current SHA and preserve complete logs in ci-logs/.
- [x] Read the failing job log and reproduce the exact CDN failure locally.
- [x] Investigate CDN resolution and choose a fix that retains real Deno HTTP coverage.
- [x] Add a failing regression test before changing behavior if code needs correction.
- [x] Implement and run focused tests, then all relevant local checks sequentially.
- [x] Review the complete PR diff for compatibility, release metadata and scope.
- [ ] Commit atomic changes and push only issue-235-32c1444df9bd.
- [ ] Verify fresh final-head CI, preserving and diagnosing any failing job logs.
- [ ] Update PR title/body with accurate reproduction, verification and closing keyword.
- [ ] Mark PR #236 ready, verify clean working tree and report the PR URL.

Keep experiments finite, store scripts here, and run memory-heavy checks sequentially.
Do not skip real failures or claim an unmet criterion is complete.

## Root cause and correction

The failing job belongs to head `285f44b`, created 2026-10-24T08:20:11Z.
Downloaded `ci-logs/deno-120825515833.log` has 606 lines; line 550 records
HTTP 408 for the Execa 10.2.1 import, and line 565 records exit code 1.
The same import and the immutable GitHub-source URL both failed locally.
esm.sh's status endpoint confirmed that these cold builds were queued.

The harness now retries only Deno import failures reporting HTTP 408 from
`https://esm.sh/`, at most three attempts with 5- and 10-second delays.
Each retry starts a fresh Deno process, retains complete stderr in the CI log,
and stores a bounded diagnostic tail for classification. Exhausted timeouts,
compiler errors, runtime assertions and other hosts fail normally.
Both public-CDN probes and all release prerequisites remain enforced.

`ci-logs/deno-retry-before.log` records the test-first failure before adding the
retry helper. All ten retry regressions now pass with mocked probes and delays.
After the public queue recovered, `ci-logs/deno-retry-live.log` records both
real HTTP probes passing: local checkout and immutable PR head, including shell
execution, ShellJS identity, normal brace globs and depth protection.
No manual action or alternate compiler is required.

The follow-up full Bun suite passed 2,812 tests, skipped 10 and failed none
across 179 files. Lint, formatting, duplication and strict TypeScript checks
also passed. Earlier Node, zx, Execa and Rust validation remains applicable:
this follow-up changes the CDN test harness and adds its regression coverage.
Final-head CI and readiness are recorded in the
[PR description](https://github.com/link-foundation/command-stream/pull/236),
which is the live verification record for the remaining checklist items.
