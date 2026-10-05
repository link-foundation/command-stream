# Validation record

## Local checks before pushing

| Check | Result | Log |
| --- | --- | --- |
| Complete Bun suite | 2315 passed, 10 skipped, 0 failed, 140 files | `bun-tests-complete.log.gz` |
| Node zx compatibility | 490 passed, 2 skipped, 0 failed | `node-zx-final.log.gz` |
| Node Execa/CommonJS/terminal compatibility | 52 passed, 0 failed | `node-compat-final.log.gz` |
| JavaScript lint, formatting, duplication, types | Passed, ESLint zero warnings | `js-check-verified.log.gz` |
| Rust all-feature tests, denied-warning Clippy and docs | Passed; 27 doc tests, 2 ignored | `rust-tests-final.log.gz` |
| Rust benchmark crate tests | Passed, 8 tests | `rust-benchmarks.log.gz` |
| Rust script tests | Passed all existing inline script suites | `rust-scripts-final-fixed.log.gz`, `rust-version-verified.log.gz` |
| Isolated Rust metadata guard regressions | 5 passed | `rust-guards-verified.log.gz` |
| Rust script release-main compilation | Passed without executing release mutations | `rust-release-build.log.gz` |
| Source/script size checks | No warnings after extraction | `rust-size-verified.log.gz` |
| Executable feature parity | All 27 features, Node/Bun/Rust | `parity-final.log.gz` |
| Generated documentation | All 29 files current | `parity-final.log.gz` |
| Benchmark smoke | Passed | `js-benchmark-smoke.log.gz` |
| actionlint, zizmor | Passed; zizmor JSON findings empty | `actionlint-verified.log.gz`, `zizmor-verified.json` |
| Secretlint | Passed | `secretlint-verified.log.gz` |

All log paths above are under `../validation/`. Earlier `before`/`initial` logs intentionally preserve old-code failures, configuration failures, and subsequent corrections. Full passing suites include the new regressions. No real packages were published locally.

## Original failed-run reruns

Pages deployment run 37345117246 attempt 2 passed at original SHA ee5a84d after repository Pages enablement. External links run 37315903872 attempt 2 passed at original SHA d9abbee after deployment. Dependency comparison changed from HTTP 403 to HTTP 200 after enabling vulnerability alerts, which enables the dependency graph.

The old Windows Bun job was cancelled at 17:35:20. A fresh direct ZIP download recovered six successful job logs but no Windows output; the fresh Windows log endpoint remains 404. The PR now preserves console/JUnit artifacts and default-off tracing for the next Windows iteration.

## Branch CI

Latest-SHA run metadata and conclusions are recorded here after pushing. They must be compared with the final branch commit rather than inferred from historical passing runs.
