# Deno CDN CI repair plan

- [x] Verify branch and clean initial worktree; create native completion goal.
- [x] Read issue, all issue comments, PR conversation, inline comments, reviews,
      and prior requirement/evidence matrix; no required sub-issues exist.
- [x] Fetch latest main and verify it is included; resolve any conflicts.
- [x] List recent CI runs with timestamps and SHAs; download failed logs into
      ci-logs/issue-30 and inspect the exact failing job.
- [x] Reproduce the HTTP import failure with bounded requests and preserve logs.
- [x] Inspect existing CDN smoke test, retry tests, workflow requirements, and
      related merged changes; choose a fix retaining meaningful Deno coverage.
- [x] Add a minimal failing regression test before fixing the root cause.
- [x] Implement and verify the fix, release fragment, and required documentation.
- [x] Run focused tests, full local JS tests, lint, format, types, duplication,
      workflow checks, and relevant Rust checks sequentially within memory limits.
- [x] Review complete PR diff for lost features and original acceptance coverage.
- [ ] Commit atomic work, push only issue-30-a0052265, and await all fresh CI runs.
- [ ] Investigate and fix any remaining failed checks using downloaded logs.
  - [x] Combine release notes after CI rejected two JavaScript changesets.
  - [x] Reproduce the Windows example integration's shared deadline with two
        finite Git delays; split Git/HTTP and retain five-second operation limits.
  - [x] Verify the Rust repair locally: 984 tests, Clippy, formatting, and the
        bounded slow-Git regression pass.
  - [ ] Await fresh platform CI for the Rust repair.
- [ ] Update PR title/body with reproduction, tests, current CI evidence, positive
      Fixes #30 reference, and exact outstanding external success outcomes.
- [ ] Mark PR #116 ready, verify clean worktree and current main ancestry; leave
      unmerged while external publication/adoption outcomes remain unverified.

All large command outputs go to logs. No stress experiments are necessary.
This committed checklist is a pre-push snapshot; the final PR description records
the new commit's CI results and completion of the remaining publication steps.
Regression/experiment scripts remain in tests or experiments; do not add ad hoc
scripts elsewhere. External registry publications require an authenticated owner;
prior evidence documents that blocker and it must not be presented as completed.
