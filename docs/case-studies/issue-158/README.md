# Issue 158 CI and Release Case Study

Issue: https://github.com/link-foundation/command-stream/issues/158
Pull request: https://github.com/link-foundation/command-stream/pull/159

## Scope

Issue 158 asked for one pull request that fixes the command-stream release pipeline using the organization-level crates.io secret pattern that already works in `link-foundation/meta-language`, investigates run `27134991249`, compares command-stream CI/CD files with the JS, Rust, Python, and C# pipeline templates, downloads the related data into `docs/case-studies/issue-158`, and documents root causes plus solution plans.

## Requirements Trace

| Requirement                                                                                                         | Evidence                                                                                                 | PR action                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Use organization-level crates.io secret behavior that works in meta-language.                                       | `templates/meta-language/release.yml` uses `CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN       |                                                                                                      | secrets.CARGO_TOKEN }}`. GitHub documents organization secrets as shared across repositories, but workflows must explicitly pass them to actions or commands. | `release.yml` now passes both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` to the crates publisher. |
| Check run `27134991249` for false positives and errors.                                                             | `data/checks-release-27134991249.log.gz` and `log-excerpts/run-27134991249-bun-ubuntu-failures.log`.     | Fixed leaked shell settings in Bun tests and turned CI trace logging off by default.                 |
| Compare CI/CD with templates.                                                                                       | Template file trees and selected workflow/script snapshots are saved under `templates/`.                 | Added Rust checks, cargo packaging, crates publish, timeouts, and dual token naming.                 |
| Download all related logs and data.                                                                                 | `data/` and `log-excerpts/` contain issue, PR, run, template, crates.io, and compressed CI log evidence. | Kept raw compressed logs plus smaller excerpts for review.                                           |
| Add a case study with timeline, root causes, solutions, online facts, and related repos if template problems exist. | This document.                                                                                           | No template issue was opened because the template repositories already contain the missing patterns. |
| Add debug or verbose output if data is insufficient.                                                                | The failing run had excessive trace output rather than insufficient output.                              | Replaced always-on verbose logging with opt-in `COMMAND_STREAM_TRACE`.                               |

## Timeline

| Time (UTC)           | Event                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-08T11:37:42Z | Referenced workflow run `27134991249` started from push SHA `4ae09177d804ddaf249c14e290ed8c06e51168b2`.                                                 |
| 2026-06-08T11:38:46Z | Ubuntu Bun test job failed in `js/tests/builtin-commands.test.mjs` after `js/tests/shell-settings.test.mjs` left `globalShellSettings.errexit` enabled. |
| 2026-06-08T11:41:19Z | PR branch initial commit `4d611e486e9ba5af3bd193aff0a33f7b46388582` was created.                                                                        |
| 2026-06-08T11:41:31Z | PR workflow run `27135178897` started.                                                                                                                  |
| 2026-06-08T11:41:41Z | Changeset check failed with `No changeset found in this PR` and `Found 0 changeset file(s) added by this PR`.                                           |
| 2026-06-08T12:01:18Z | crates.io API probe for `command-stream` returned 404, so no crate record existed at investigation time.                                                |

## Downloaded Evidence

| File                                                                                     | Purpose                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `data/checks-release-27134991249.log.gz`                                                 | Full compressed log for the referenced failing run.                      |
| `log-excerpts/run-27134991249-bun-ubuntu-failures.log`                                   | Focused excerpt of the Ubuntu Bun failures.                              |
| `data/checks-release-27135178897.log.gz`                                                 | Full compressed log for the PR changeset failure.                        |
| `log-excerpts/run-27135178897-changeset-failure.log`                                     | Focused excerpt of the changeset failure.                                |
| `data/issue-158-gh-view.txt`, `data/issue-158-comments.json`                             | Issue body and comments.                                                 |
| `data/pr-159*.json`                                                                      | PR metadata, conversation comments, inline review comments, and reviews. |
| `data/run-27134991249.json`, `data/run-27135178897.json`, `data/recent-runs-branch.json` | Run metadata used to verify timestamps and SHAs.                         |
| `data/*-pipeline-template.repo.json`, `templates/*.file-tree.txt`                        | Template repository metadata and full file-tree snapshots.               |
| `templates/**/release.yml`, `templates/**/publish-*`, `templates/**/check-release-*`     | CI/CD implementation examples used for comparison.                       |
| `data/crates-command-stream.json`                                                        | crates.io API status for the `command-stream` crate name.                |

## Root Causes

1. The release workflow only published npm. It did not run Rust CI checks, package validation, or `cargo publish`, so `rust/Cargo.toml` could be healthy locally while the release path still never shipped the crate.
2. The command-stream workflow did not pass the meta-language/template secret fallback. Organization-level secrets are usable by workflows only when they are explicitly referenced, and command-stream had no crates publish step referencing `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN`.
3. The PR had no changeset, so `Check for Changesets` failed before lint/test jobs could run.
4. The Ubuntu Bun failure in run `27134991249` was a test isolation problem. `shell-settings.test.mjs` enabled `errexit`; later built-in command tests expected nonzero virtual command results to be returned, but `_runVirtual` threw because global shell state still had `errexit` enabled.
5. The workflow forced command tracing for all Bun tests with `COMMAND_STREAM_VERBOSE=true`, producing very large logs and false-positive-looking noise around otherwise expected nonzero command behavior.
6. `.github/DEPLOYMENT.md` described older/manual publishing details and did not reflect the actual consolidated trusted-publishing release workflow.

## Template Comparison

| Source                                           | Relevant practice found                                                                                                  | Command-stream gap                                                                             | Applied here                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `js-ai-driven-development-pipeline-template`     | Consolidated npm trusted publishing in one release workflow, explicit job timeouts, changeset validation.                | command-stream had npm publishing, but the PR lacked a changeset and some jobs had no timeout. | Added a changeset and job timeouts. Kept npm trusted publishing path intact.             |
| `rust-ai-driven-development-pipeline-template`   | Rust fmt, clippy, tests, doc tests, package validation, and crates publish with `CARGO_REGISTRY_TOKEN \|\| CARGO_TOKEN`. | No Rust CI lane and no crates publish.                                                         | Added `rust-check` and crates publish in release and instant-release jobs.               |
| `meta-language`                                  | The same dual-token crates.io secret pattern is already used successfully.                                               | command-stream did not reference the organization secret in the workflow.                      | Matched the dual-token env mapping.                                                      |
| `start`                                          | Idempotent `publish-to-crates.mjs` checks crates.io before publishing and accepts both cargo token names.                | command-stream had no crates publisher script.                                                 | Added `scripts/publish-to-crates.mjs` with already-published handling and focused tests. |
| `python-ai-driven-development-pipeline-template` | Timeouts and OIDC-style release permissions.                                                                             | No Python-specific release behavior applies.                                                   | Borrowed the timeout/permissions discipline where relevant.                              |
| `csharp-ai-driven-development-pipeline-template` | Timeouts and release gating across many jobs.                                                                            | No C#-specific release behavior applies.                                                       | Borrowed the timeout discipline where relevant.                                          |

No issue was opened against the template repositories because the missing cargo secret fallback and Rust release checks already exist in the relevant templates.

## Online Facts Used

| Source                               | Fact used                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cargo Book, `cargo publish`          | `cargo publish` creates and uploads a distributable `.crate`; it requires authentication by cargo login or registry token configuration; the default registry is crates.io. |
| GitHub Actions Secrets documentation | Organization-level secrets can be shared across repositories, but a workflow must explicitly expose a secret to an action or command through workflow syntax.               |
| npm Trusted Publishers documentation | npm trusted publishing uses OIDC from GitHub Actions and requires `id-token: write`; the current npm publish flow should stay in the trusted publisher workflow.            |

## Implemented Solution

The PR adds a `rust-check` job to `.github/workflows/release.yml` with `cargo fmt`, `cargo clippy`, Rust tests, Rust doc tests, and `cargo package`. The release and instant-release jobs now set up Rust and publish the crate after npm publish by running `bun scripts/publish-to-crates.mjs --working-dir rust`.

The crates publisher reads `rust/Cargo.toml`, checks crates.io for the exact package version before publishing, reports success when the version already exists, and accepts either `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN`. The script is covered by a focused Bun test with a local mock crates.io API.

Release versioning now also runs `scripts/sync-rust-version.mjs`, so changeset and instant releases keep `rust/Cargo.toml` and `rust/Cargo.lock` aligned with the package version before publishing the crate. The current Rust crate metadata was synchronized from `0.8.3` to `0.9.4`.

The Bun test failures are addressed by resetting shell settings in `shell-settings.test.mjs` after each test and explicitly disabling global shell options before each built-in command test. CI tracing is now opt-in through `COMMAND_STREAM_TRACE`, reducing noisy logs while preserving a switch for deeper investigations.

The PR also adds the required changeset, updates deployment documentation, adds a crates.io badge to the README, and applies `cargo fmt` so the new Rust formatting gate can pass.

## Verification Plan

Local checks for this PR should include:

```bash
bun test js/tests/shell-settings.test.mjs js/tests/builtin-commands.test.mjs js/tests/publish-to-crates.test.mjs
bun test js/tests/sync-rust-version.test.mjs
bun scripts/sync-rust-version.mjs
bun run format:check
bun run lint
bun run check:duplication
GITHUB_BASE_SHA=$(git merge-base origin/main HEAD) GITHUB_HEAD_SHA=$(git rev-parse HEAD) bun scripts/validate-changeset.mjs
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --all-targets --all-features
cargo test --manifest-path rust/Cargo.toml --all-features --verbose
cargo test --manifest-path rust/Cargo.toml --doc --all-features --verbose
cargo package --manifest-path rust/Cargo.toml --allow-dirty
```

After push, CI should be checked against the new head SHA to confirm the previous stale failures are replaced by a fresh run.

## Follow-up Options

crates.io trusted publishing should be reviewed separately when it is mature enough for the repository's release policy. This PR keeps the proven token-based crates publish path because the issue specifically asks for the organization-level secret behavior that already works in meta-language.
