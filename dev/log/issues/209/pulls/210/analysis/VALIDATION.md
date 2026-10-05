# Validation record

## Local checks before pushing

| Check | Result | Log |
| --- | --- | --- |
| Complete Bun suite, exact CI invocation | 2333 passed, 10 skipped, 0 failed, 142 files; 197.35 seconds | `bun-tests-complete-final.log.gz` |
| Node zx compatibility | 490 passed, 2 skipped, 0 failed | `node-zx-final.log.gz` |
| Node Execa/CommonJS/terminal compatibility | 52 passed, 0 failed | `node-compat-final.log.gz` |
| JavaScript lint, formatting, duplication, types | Passed, ESLint zero warnings | `js-check-restaging.log.gz`, `js-check-bun-retry.log.gz` |
| Rust all-feature tests, denied-warning Clippy and docs | Passed; 27 doc tests, 2 ignored | `rust-tests-final.log.gz` |
| Rust benchmark crate tests | Passed, 8 tests | `rust-benchmarks.log.gz` |
| Rust script tests | Passed all existing inline script suites | `rust-scripts-final-fixed.log.gz`, `rust-version-verified.log.gz` |
| Isolated Rust metadata guard regressions | 5 passed | `rust-guards-verified.log.gz` |
| Rust release Git/path/tag regressions | 11 passed; explicit paths and repeated deleted-fragment staging included | `rust-release-paths-after.log.gz` |
| JavaScript release Git and Bun retry regressions | 11 passed; seven Git cases and four strict retry-policy cases | `js-restaging-and-oracle-after.log.gz` |
| Complete Bun reference, Bun port and Node port corpora | Each 1216 passed, 40 skipped, 0 failed | `bun-reference-final.log.gz`, `bun-port-corpus-final.log.gz`, `node-port-corpus-final.log.gz` |
| Rust Bun-shell compatibility tests | 114 passed, 2 ignored, 0 failed | `rust-bun-corpus-final.log.gz` |
| Rust script release-main compilation | Passed without executing release mutations | `rust-release-paths-build.log.gz` |
| Source/script size checks | No warnings after extraction | `rust-size-paths.log.gz` |
| Executable feature parity | All 27 features, Node/Bun/Rust | `parity-final.log.gz` |
| Generated documentation | All 29 files current | `parity-final.log.gz` |
| Benchmark smoke | Passed | `js-benchmark-smoke.log.gz` |
| actionlint, zizmor | Passed; zizmor JSON findings empty | `actionlint-verified.log.gz`, `zizmor-verified.json` |
| Secretlint | Passed, pinned 13.0.5, including collected evidence | `secretlint-archive-final.log.gz` |

All log paths above are under `../validation/`. Earlier `before`/`initial` logs intentionally preserve old-code failures, configuration failures, and subsequent corrections. Full passing suites include the new regressions. No real packages were published locally.

## Original failed-run reruns

Pages deployment run 37345117246 attempt 2 passed at original SHA ee5a84d after repository Pages enablement. External links run 37315903872 attempt 2 passed at original SHA d9abbee after deployment. Dependency comparison changed from HTTP 403 to HTTP 200 after enabling vulnerability alerts, which enables the dependency graph.

The old Windows Bun job was cancelled at 17:35:20. A fresh direct ZIP download recovered six successful job logs but no Windows output; the fresh Windows log endpoint remains 404. The PR now preserves console/JUnit artifacts and default-off tracing for the next Windows iteration.

## Branch CI

The first implementation commit `297e95bbe362e34bfb45a285c9f0d85a89a7f675` triggered runs 37356457264 (workflow lint), 37356457330 (quality), 37356457395 (Bun Shell), 37356457443 (benchmarks), 37356457385 (JS), 37356457273 (Rust), and 37356457412 (security). All workflow jobs completed successfully, including genuine dependency review and the entire OS/runtime matrix. The initial parity run 37356457310 required the documented exemption for a Rust-only module extraction; run 37356657989 then passed all 27 executable features and docs on the same SHA after applying `parity-exempt`.

The separate CodeQL result check failed with three findings despite successful analysis jobs. Full annotations and metadata are archived. These findings were reproduced and repaired; `codeql-regressions-before.log.gz` contains nine failing assertions, and `codeql-regressions-after.log.gz` contains 19 passing cases. Rust final-review fixes have two old-behavior Git failures, an additional push-classification failure, and 11 final passing tests; `rust-release-paths-build.log.gz` verifies real release-program compilation with denied warnings. Subsequent CI confirms all these repairs.

All first-implementation workflow logs are archived. The three `implementation-bun-tests-*.zip` artifacts contain both console output and valid JUnit XML. Linux and macOS: 2,319 passed, 10 skips, zero failures. Windows: 1,818 passed, 518 existing platform skips, zero failures, 159.88-second test execution. These results verify artifact retention and successful Windows completion without proving the historical cancellation's exact cause.

The follow-up implementation SHA `65639ea75304f32fbf1d2d4ae72037798fd5c60e` completed all eight branch workflows successfully (runs 37359657496, 37359657597, 37359657661, 37359657753, 37359657755, 37359657798, 37359657839 and 37359657945). There are 44 passing checks and six expected main-only release skips. CodeQL confirms “No new alerts in code changed by this pull request”; no alerts were dismissed or rules disabled. The prior Rust run at `957e8d9` was superseded/cancelled by this push, while the earlier Bun reference failure is investigated separately as F15.

Additional before/after cases cover Rust explicit-root normalization/repeated deletions, JavaScript repeated consumed-fragment staging, and the bounded Bun reference workaround. The invalid local invocation `cd js && bun test` is preserved as `bun-tests-wrong-cwd.log.gz`: some existing fixtures require repository-root paths. It is superseded by the exact CI invocation from the repository root, not treated as evidence of a product defect or a passing validation.

A repository-root run with Bun's default five-second test budget recorded one live `gh gist list` timeout (log lines 1508–1530). Cleanup terminated the pending child, producing the subsequent exit-143 assertion; this is not a release-helper failure. The existing CI command already specifies `--timeout 10000`. The isolated test passes with trace enabled using that same existing CI budget (five tests, no failures). Final full-suite validation uses the exact CI command from the repository root; no CI or test timeout was increased. Both invocation/budget investigation logs are retained.

## Final source verification

Final source SHA `5a2a97e0b7cc65093eec824aac47f366b2786be4` passed all eight workflows created at 19:05:02 UTC: 37360806444 (parity), 37360806458 (workflow lint), 37360806475 (benchmarks), 37360806505 (quality), 37360806624 (security), 37360806683 (Rust), 37360806688 (Bun Shell), and 37360806691 (JavaScript). `../github/final-source-checks-current.json` records 44 successful checks and six expected main-only release skips. `../github/final-source-runs.json` confirms every run's exact head SHA and timestamp; complete workflow logs are retained under `../ci-logs/run-<id>.log.gz`.

The final repository-root command `bun test js/tests/ --timeout 10000` passes all 2333 tests with ten existing skips, zero failures and 65293 assertions in 197.35 seconds. The three final-source Bun artifact ZIPs are downloaded, SHA-256 checked against GitHub's recorded digests, validated as ZIPs and parsed as JUnit XML; their summaries are in `final-source-artifacts.log.gz`. They preserve the successful Linux/macOS/Windows output at this exact source commit.

The annotation-marker review is `../github/final-source-log-review.json`. The only actual workflow warnings are CodeQL's three 300-file diff-limit notices. The action rejects incomplete optimization data, initializes standard source-root databases and successfully uploads all three SARIF results. F13 documents the checked fallback and native Git source review. The fourth regex marker in the audit log is printed install-action shell source containing an error-format string, not an emitted error.

## Hosted-runner incident during archive verification

Evidence commit `1cbd0a7daaf72d11f30cdc063f5339d6712dc481`, pushed at 19:18:33 UTC, triggered eight workflows at 19:18:58. Five workflows passed; JavaScript run 37362523666, Rust run 37362523769 and security run 37362524035 failed because eight jobs never acquired a hosted runner. Every affected job has `runner_id=0`, an empty step list, and an explicit allocation-failure annotation. No cancelled job ran product assertions. Individual check conclusions were 34 successes, seven skips (including a dependency of a cancelled job) and eight cancellations; the CodeQL result check was not created because no analysis runner was assigned.

The official GitHub incident began at 19:11:58, before that push. Its 19:50:50 update still reports assignment delays across runner configurations. `../github/hosted-runner-incident-evidence.json` preserves all original run/job metadata, annotations and official status data. `../ci-logs/run-<id>-attempt-1.log.gz` retains every available job's output, with original ZIPs and CLI 404 responses for the three incomplete full-log downloads. Similar upstream reports/screenshots are contextual evidence, not proof of this service's internal cause. F16 distinguishes this confirmed allocation failure from the historical Windows timeout.

GitHub rejects reruns while the containing workflow remains active (HTTP 403, preserved). After all original workflows completed, `gh pr checks --watch` exited zero despite eight cancelled checks; acceptance therefore inspects each exact-head workflow and check conclusion rather than relying on that exit code.

The incident-evidence commit changes collected data and analysis only. Its latest-SHA CI is checked separately before marking the PR ready, with failed allocation jobs rerun at the same commit when necessary. The tested OS matrix, security gates and finite test budgets remain enforced. Post-commit verification metadata/logs are written to `../github/finalization.log` and `../ci-logs/final-archive-*.log`, and the final PR description records the actual result. A commit's own future CI output cannot already be contained in that commit.
