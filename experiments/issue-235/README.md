# Issue #235 work plan and evidence

Objective: implement and verify the lightweight entry option from issue #235
in PR #236, preserving the existing full API.

- [x] Read the complete issue, required sub-issues (none), and all three PR
      feedback endpoints (no comments or reviews).
- [x] Inspect entry points, shared state, declarations, release and CI policies,
      and related merged PRs #194 and #234.
- [ ] Reproduce the import graph and commit failing regression tests first.
- [ ] Extract shared shell/virtual-command initialization into a public core
      entry, with ESM/CommonJS exports and accurate declarations.
- [ ] Verify real commands, pipelines, quoting, shared state, and full API
      compatibility; enforce a deterministic module budget in CI.
- [ ] Document the entry choice and measurement command; add a release changeset.
- [ ] Diagnose existing CI failures using timestamp/SHA-matched downloaded logs,
      fix their causes, and verify the specific failures.
- [ ] Run local suites and quality checks sequentially within the memory limit.
- [ ] Review the complete PR diff, merge any default-branch updates, commit and
      push only to issue-235-32c1444df9bd.
- [ ] Update PR title/body with reproduction and verification evidence, await
      passing final-head CI, mark ready, and confirm a clean working tree.

## Initial CI investigation

Run 40076348439 belongs to the initial branch commit `8a5ee77`, created
2026-10-24T08:00:34Z. Its downloaded log is
`ci-logs/dependencies-40076348439.log` (ignored local evidence).
Lines 665–667 report Execa 10.1.1 vs 10.2.1 and fancy-regex 0.19.2 vs 0.20.0.
The Execa blocker must be rechecked because the upstream issue has closed.

## Scope

The issue explicitly proposes a lightweight `command-stream/core` entry as an
alternative to changing the main API's loading behavior. The core entry will
share implementations and state with the full entry. Compatibility layers,
terminal capture, REPL/debugger and testing helpers remain available through
the full entry and dedicated compatibility subpaths. Installed dependency size
is unchanged; this addresses startup/module loading and bundling.
