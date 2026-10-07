# Validation

Every log named here is in `../validation/`. Unless a log says otherwise, "before" is main at `1fc9e3a` and "after" is this branch. Each reproduction script is in `experiments/issue-216/` and builds its own throwaway worktree or repository.

## Before/after reproductions

| Finding | Script | Before | After | Log |
| --- | --- | --- | --- | --- |
| F1 Changesets formatter | `reproduce-changeset-version.sh` | `spawn deno ENOENT`, exit 1 (`config.format` unset, no deno on PATH) | `changeset version exit status: 0`; CHANGELOG formatted by Prettier | `changeset-version-before.log`, `changeset-version-prettier.log` |
| F1 in the JS template (`1e43fdb`) | `reproduce-template-changeset-version.sh` | Same failure | Passes with `"format": "prettier"` | `template-changeset-version-{before,prettier}.log` |
| F2 JS signal tests | `signal-before-after.sh` + `with-load.sh` (96 busy loops, 6 cores) | 5 of 20 runs fail | 0 of 20; whole suite 0 of 15 | `signal-before-after.log` |
| F2 handler latency | `signal-handler-latency.mjs` | 12 of 60 handlers cut off at the 100 ms grace | 0 of 60 at a long grace; p90 158 ms, max 565 ms | `signal-latency-ready.log` |
| F2 Rust signal tests | `rust-signals-before-after.sh` | 0 of 15 (not reproduced) | 0 of 15 | `rust-signals-before-after.log` |
| F4 lockfile freshness | `cargo-lockfile-freshness.sh` | `warning: not updating lockfile due to dry run` | No warning; a stale pin (`itoa`) fails with the diff | `cargo-lockfile-freshness.log` |
| F5 missing GitHub release | `bun test js/tests/check-release-needed.test.mjs` against old and new script | 3 pass, 3 fail | 6 pass | `github-release-missing-before-after.log` |
| F6 fragment placement and bump | `changelog-fragment-check.sh` | root, nested and misspelled-bump cases pass | they fail; the good case passes | `changelog-fragment-check.log` |
| F9 examples with spaces in the path | example runner in a directory containing a space | every file "Error running test", exit 1 | correct pass/fail per file | `example-test-runner-spaces.log` |
| F11 rename detection (git only) | `rename-detection-repro.sh` | see the table in REPORT.md F11 | replaced, moved and code-out all classified correctly | `rename-detection-repro.log` |
| F11 Rust fragment check | `changelog-fragment-check.sh` | `renamed` exits 1 (valid PR rejected) | `renamed` 0, `moved` 1 | `changelog-fragment-check-renames.log` |
| F12 lychee retries | `lychee-retry-503.py` (local mock server, `python3 -I`) | 1 request per 503 for every `--max-retries` / `--retry-wait-time` combination | Re-check step recovers or fails per link (tests below) | `lychee-retry-503.log`, `link-recheck.log`, `lychee-0.24.2-report-sample.md` |

## Final local checks (`local-checks.log`, at `71f7c25`)

Toolchain: bun 1.4.2, node v26.10.0, cargo 1.98.1, git 2.43.0.

| Check | Result |
| --- | --- |
| `bun run check` (eslint `--max-warnings 0`, prettier `--check`, jscpd, tsc) | exit 0 |
| `check:parity`, `docs:check`, `check:dependencies` | exit 0 |
| actionlint on every workflow | exit 0 |
| `cargo fmt --check` | exit 0 |
| `cargo clippy --all-targets --all-features --color never -- -D warnings` | exit 0, 0 `warning` lines |
| `cargo test` | 830 passed, 0 failed, 5 ignored |
| `rust-script --test` on `check-changelog-fragment.rs` / `detect-code-changes.rs` | 2 passed / 0 tests |
| `bun test js/tests/ --timeout 10000` | 2581 pass, 15 skip, 28 fail across 157 files |

All 28 local failures are jq tests (`jq.test.mjs`, `jq-color-behavior.test.mjs` and the jq streaming suites). jq is not installed in this sandbox (`command -v jq: none`). CI installs it in `js.yml` (`Install jq`), so these failures are environmental. The full outputs are in `local-bun-test.log.gz` and `local-cargo-test.log.gz`.

## New and changed tests

- `js/tests/changeset-config.test.mjs`: the formatter is pinned and the versioning dry-run stays wired (F1).
- `js/tests/signal-handling.test.mjs`, `rust/tests/signals.rs`: readiness and bounded polling (F2).
- `js/tests/bun-reference-retry.test.mjs`: the corpus report goes to a sink and is asserted on (F3).
- `js/tests/dependency-freshness.test.mjs`: the extracted step runs against a mock `cargo` that rejects `--dry-run` (F4).
- `js/tests/check-release-needed.test.mjs`, `js/tests/github-release-state.test.mjs`: release self-heal, using a mock GitHub API (F5).
- `rust/scripts/check-changelog-fragment.rs` unit tests (F6).
- `js/tests/workflow-hygiene.test.mjs`:
  - the doc-test step is gone (F7);
  - CodeQL keeps every shipped path analysed (F9);
  - the Cargo warnings gate and the link re-check are wired (F10, F12).
- `js/tests/gh-commands.test.mjs`, `js/tests/gh-gist-operations.test.mjs`, `js/tests/stderr-output-handling.test.mjs`: gist URLs are matched by prefix (F9).
- `js/tests/cargo-warnings-gate.test.mjs`: runs the real clippy step with a mock `cargo` (F10).
- `js/tests/validate-changeset.test.mjs`, `js/tests/language-parity.test.mjs`: replaced, moved and renamed paths (F11).
- `js/tests/recheck-transient-links.test.mjs`: 8 tests against a local `Bun.serve` (F12).

## CI on the pull request

The latest-SHA CI result is recorded in the PR description after the final push.
