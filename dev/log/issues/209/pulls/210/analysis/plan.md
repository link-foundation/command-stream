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
- [x] Fetch latest main and verify it is already an ancestor; push validated source only to issue-209-4043f0c126d5 and prepare the final PR 210 scope, reproduction and validation description.
- [x] Inspect source diffs through native Git/paginated APIs, verify complete requirement coverage, and preserve/review every final-source CI log: eight workflows pass at 5a2a97e with 44 successful checks and six main-only skips.

- [x] Preserve all original final-archive cancellations, available logs, missing-log/API responses, official hosted-runner incident updates, and contextual upstream reports/screenshots; document F16 without assigning an unsupported client-code cause.

Post-archive acceptance: commit/push the completed incident evidence, verify the archive commit's latest-SHA CI and rerun failed allocation jobs at the same head after provider recovery, check a clean tree and main ancestry, update the live PR description with that exact result, mark PR 210 ready, and return its URL. These actions necessarily follow this archive snapshot; their completion is recorded in local `../github/finalization.log`, `../ci-logs/final-archive-*.log` and the live PR description.
