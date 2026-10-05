# Issue 209 / PR 210 work plan

- [x] Read repository instructions, issue details and all issue/PR comment types.
- [x] Preserve complete issue/PR metadata, recent CI runs with timestamps and SHAs, jobs and logs for all referenced runs and relevant branch runs.
- [x] Inventory every workflow and CI script; download complete trees and CI-related files from the JS, Rust and Python templates at recorded commits.
- [x] Read the referenced CI/CD best practices; compare every repository workflow/CI script against all three templates and document applicability and differences.
- [x] Reconstruct the timeline, enumerate every requirement, distinguish real failures, false positives/negatives and warnings, and identify each root cause using log line citations.
- [x] Research authoritative upstream documentation and existing tools/libraries; preserve research sources and evaluate remedies.
- [x] Create minimal failing regression tests/experiments for identified defects before implementation; keep probes under experiments/ and bound any resource stress.
- [x] Fix every affected occurrence, add opt-in diagnostics where root causes remain uncertain, preserve existing behavior, and prepare release changes only when applicable.
- [x] Report reproducible shared defects to related/template repositories with workarounds and code suggestions when warranted.
- [x] Run applicable local CI and full local test suites; save and review logs, update analysis and commit atomic validated changes.
- [ ] Merge latest main when necessary, push only issue-209-4043f0c126d5, update existing PR 210 with final scope, reproduction and validation.
- [ ] Inspect final PR diff, verify complete requirement coverage and a clean tree, wait for latest-SHA CI, preserve/review nonpassing logs and fix any remaining failures.
- [ ] Mark PR 210 ready and return its URL with concrete results and any evidenced limits.
