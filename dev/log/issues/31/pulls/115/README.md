# Issue 31 / PR 115 verification

## Scope and plan

1. Read the edited issue, PR description, conversation comments, inline review comments and reviews.
2. Compare the 2025 branch with current main and inspect the latest merged stream-processing work (PR 225).
3. Merge main without rewriting history; preserve its migrated JavaScript/Rust implementation and adapt the original examples/tests to the current `.stream()` API.
4. Reproduce missing deadline batching before implementation in JavaScript and Rust. Add bounded regression coverage, implement both languages and keep release-managed version numbers unchanged by using release fragments.
5. Compare installed alternatives with a finite common transformation and cite primary documentation; describe buffering/backpressure limits accurately.
6. Run focused and full tests, lint, declarations, duplication, formatting, generated documentation and executable language parity. Run memory-intensive validation sequentially, with Cargo jobs=1 and debug information disabled.
7. Review the complete PR diff, commit, push only the prepared branch, update PR 115 and verify CI against the new SHA/timestamp. For non-passing runs, preserve logs, inspect the actual error locations, fix and recheck.
8. Confirm current main is included, the working tree is clean, all CI checks pass and mark PR 115 ready.

## Findings and reproduction

The issue was closed by PR 225, which introduced the current pull-driven JavaScript and bounded Rust stream APIs. This old branch conflicted with the migration to `js/` and `rust/`, and its original tests/examples expected the old chunk-wrapper API. The merge retains current main's code and all existing interfaces; examples now process ordinary line/value results, concurrent split branches and online stats callbacks.

Deadline batching was still absent in both languages. The JavaScript regression called `.batch(10, 20)` on a source that emitted one item and then waited on a gate. The second argument was ignored, so the first `next()` did not produce `[1]` before the bounded 500 ms probe ended. `reproduce-js.log.gz` records 5 passes and 3 failures: missing slidingWindow alias, missing idle flush and missing deadline validation. The Rust regression used existing `.batch(10)` on a gated source; its bounded 200 ms wait expired (`reproduce-rust.log.gz`, lines 173–187). It now uses `.batch_with_timeout(10, Duration::from_millis(20))` and receives `[1]`, then `[2,3]` after release.

The implementation measures from the first item and keeps a single pending JavaScript read across timeouts; Tokio mpsc receives are cancellation-safe. Monotonic deadline checks handle continuously ready input as well as timer wakeups. Both implementations retain full/final batches, avoid empty batches, propagate cancellation and bound upstream production.

The finite competitor probe produces `[4,8]` in command-stream, Node Readable, Execa generator transforms, zx iteration, async ShellJS and Bun Shell. Bun Shell yields a trailing empty string for this fixture, which the probe explicitly ignores. This is an API comparison, not a speed ranking. The public [processing guide](../../../../../../docs/stream-processing-guide.md) includes primary-source links and generic Rust futures/Tokio alternatives; no exclusive streaming or universal performance claim is made.

## Earlier CI and local environment

The only old branch run was [CI 17592499716](https://github.com/link-foundation/command-stream/actions/runs/17592499716), created 2025-09-09 at 18:44:06Z on `37f82a3`. It was cancelled. The logs have expired: GitHub returned HTTP 410 when downloading them; the error is preserved as `old-ci-log-download-error.txt`. There is no available log evidence to infer why it was cancelled.

The first full Bun run found 28 jq-related failures because jq was absent, and one existing wall-clock parallel-sleep assertion exceeded 750 ms while lint was running concurrently (log lines 5384–5390). The `jq: not found` evidence appears around lines 5760–6050 in `full-js-initial.log.gz`. CI already installs jq. Passwordless sudo was unavailable, so jq 1.8.1 was installed in `/tmp/issue31-tooling/bin` from the official jqlang GitHub release and verified against its SHA256 manifest. All 34 jq/color/timing tests passed with the corrected PATH; no product or test-timeout changes were needed for these environment failures.

The portable JS examples ran in both Node and Bun. ESLint, strict declarations and the duplication gate passed (2.53% cloned lines). The Rust reproduction compiled with a peak child RSS of 528,900 KiB, and its first focused successful run used 473,240 KiB. Final local results follow; new CI is checked against the published SHA before marking the PR ready.


## Final local validation

- `cargo test --all-features -- --test-threads=2` passed, including native UTF-8 command framing and the direct Tokio Stream transform/filter/deadline-batch comparison. The final full run peaked at 624,292 KiB child RSS; Clippy peaked at 515,812 KiB.
- Repository ESLint, strict ESM/CommonJS declarations, duplication (2.53%), Prettier, Rust formatting, Clippy (`-D warnings`) and rustdoc (`-D warnings`) passed.
- All 34 feature examples execute in both languages; Node/Bun observations match. The 36 generated documentation files are current and all 217 documentation validation tests pass.
- All four updated JS demos execute in Node and Bun; `cargo run --example stream_monitoring` succeeds with eight live metric updates and two partial alert batches.
- The finite memory experiment ran 100,000 records / 25.6 MB in separate Node processes with 128 MiB heap caps. Streaming RSS grew 7,077,888 bytes (about 6.8 MiB) and buffered capture grew 75,194,368 bytes (about 71.7 MiB). These are single-run capture-strategy observations, not competitor performance claims; exact outputs are preserved as JSON.

The final monolithic Bun run passed 2,715 tests and skipped 10, with one existing wall-clock failure (`full-js-final.log.gz`, lines 5363–5377): two successful, overlapping 500 ms sleeps took 981 ms against a 750 ms wall-clock limit. This happened without a concurrent build/lint process, so the earlier lint overlap does not fully explain the timing sensitivity. The unmodified sleep file and all new stream tests passed independently (19 passes, `js-final-focused.log.gz`). No timeouts or sleep assertions were relaxed. `experiments/issue-31/check-js.py` runs every discovered JS test file, with that existing timing file in a separate Bun invocation; both invocations passed: 2,710 passes / 10 skips in 170 files, then all 6 timing tests in the final file (`full-js-isolated.log.gz`). CI continues to use the original full-suite command.


## Fresh CI dependency failure

The first new run started 2026-10-11 at 18:09:13Z on `5ea742ac9fb6179158ceaec8ae2852c5d025006a`, after the 18:08:46Z merge commit. [Dependency freshness 38162610595](https://github.com/link-foundation/command-stream/actions/runs/38162610595) failed because the registry's newest stable serde_json was 1.0.154 while six declarations still specified 1.0.152. The downloaded log is preserved as `dependency-freshness-38162610595.log.gz`: lines 648–654 identify the two crate declarations, benchmark manifest and three embedded release-script manifests. This failure is in dependency freshness; its 14 policy tests passed.

Updated all six declarations and both Rust lockfiles to serde_json 1.0.154. The local freshness command now checks 90 direct dependencies with zero stale or unverifiable declarations (`dependencies-final.log.gz`). The follow-up keeps the source API unchanged. All Rust tests and Clippy pass again with serde_json 1.0.154; peak child RSS was 626,452 KiB for tests and 517,408 KiB for Clippy (`full-rust-serde.log.gz`, `clippy-serde.log.gz`). All 14 local dependency-policy tests pass. The first head's quality, executable language parity, benchmark smoke tests and Node 22/24/26 checks pass; final CI is verified on the updated head in the PR description.
