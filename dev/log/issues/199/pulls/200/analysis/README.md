# Issue #199 — deep analysis

> Evidence root: `dev/log/issues/199/pulls/200/`
> Issue: <https://github.com/link-foundation/command-stream/issues/199>
> Pull request: <https://github.com/link-foundation/command-stream/pull/200>

## 1. Evidence collected

| Path | What it is |
| --- | --- |
| `api/issue-199.json`, `api/pr-200.json` | Issue and PR metadata + comments |
| `api/repo.json` | Repository settings |
| `api/branch-protection.json` | `404 Branch not protected` for `main` |
| `api/rulesets.json` | `[]` — no rulesets configured |
| `api/runs-recent.json` | Last workflow runs on `main` |
| `api/run-<id>.json` | Per-run job/step conclusions (7 runs) |
| `ci-logs/run-<id>.log` | Full raw logs of the same 7 runs (0.8–1.9 MB each) |
| `workflows/` | Snapshot of `.github/workflows/*` before the fix |
| `templates/` | `CI-CD-BEST-PRACTICES.md` + file trees of both pipeline templates |
| `analysis/actionlint-before.log` | actionlint 1.7.7 run against the workflows (4 findings) |
| `analysis/zizmor-before.log` | zizmor `--min-confidence medium` run (58 findings) |
| `analysis/clippy-before.log` | `cargo clippy --all-targets --all-features` (15 warnings, exit 0) |
| `analysis/js-scripts-diff.log` | `js/scripts/*` vs js template |
| `analysis/rust-scripts-diff.log` | `rust/scripts/*` vs rust template |

## 2. Timeline of the failing release (run 33914574283)

Reconstructed from `ci-logs/run-33914574283.log`.

| Time (UTC) | Event |
| --- | --- |
| 20:07:5x | `release` job starts on `main` @ `1975cd7` after `lint` + `test` pass |
| 20:08:36 | `changeset publish` prints `🦋 success packages published successfully: command-stream@0.20.1` and `🦋 New tag: v0.20.1` — **the publish really succeeded** |
| 20:08:36 | `publish-to-npm.mjs` sleeps `VERIFY_DELAY` = 2 s |
| 20:08:38 | `npm view command-stream@0.20.1 version` → `npm error code E404 / 404 No match found for version 0.20.1` — registry read replica has not caught up yet |
| 20:08:38 | Script logs `Publish failed: version not found on npm after publish attempt, waiting 10s before retry...` |
| 20:08:48 | Attempt 2: `changeset publish` → `npm error code E409 / 409 Conflict — PUT https://registry.npmjs.org/command-stream — Cannot publish over previously staged version "0.20.1"` |
| 20:08:5x | `E409` text matches `FAILURE_PATTERNS` (`'npm error code e'`) → treated as a hard failure |
| 20:09:0x | Attempt 3: identical `E409` |
| 20:09:0x | `❌ Failed to publish after 3 attempts` → job **red** |

Independent verification performed during this investigation:

```
$ npm view command-stream versions        # includes 0.20.1
$ npm view command-stream dist-tags       # latest: 0.20.1
```

**The npm release succeeded; CI reported a failure. This is the false positive
named in the issue title.**

## 3. Requirements extracted from issue #199

| # | Requirement (verbatim intent) | Where addressed |
| --- | --- | --- |
| R1 | Check for **all false positives** in CI/CD and fix them | §4.1, §4.9 |
| R2 | Check for **all false negatives** in CI/CD and fix them | §4.2, §4.3, §4.4, §4.6 |
| R3 | Check for **all warnings** in CI/CD and fix them | §4.2, §4.3, §4.5 |
| R4 | Check for **all errors** in CI/CD and fix them | §4.1, §4.5 |
| R5 | Compare **all files** (full tree, all workflows and CI/CD scripts) against `link-foundation/js-ai-driven-development-pipeline-template` | §5 |
| R6 | …and against `link-foundation/rust-ai-driven-development-pipeline-template` | §5 |
| R7 | Reuse **all their best practices** | §5, §6 |
| R8 | If the same issue exists in a template, **report an issue in the template too** | §7 |
| R9 | Follow `link-assistant/hive-mind/docs/CI-CD-BEST-PRACTICES.md` | §6 |
| R10 | Apply every fix **everywhere** the problem occurs (JS *and* Rust, every workflow, every job) | §4 (each row lists all sites) |

## 4. Root causes

### 4.1 FALSE POSITIVE — npm publish reported as failed after a successful publish

* **Site:** `js/scripts/publish-to-npm.mjs`
* **Root cause A — single-shot verification.** `attemptPublish()` sleeps a fixed
  `VERIFY_DELAY` (2 s) and then calls `npm view` exactly once. npm's registry is
  read-replicated; a freshly published version routinely takes longer than 2 s
  to become visible to `npm view`. One miss is treated as "publish failed".
* **Root cause B — E409 is misclassified.** On the retry, npm answers
  `E409 Cannot publish over previously staged version`, which *proves* the
  version is already there. The generic pattern `'npm error code e'` in
  `FAILURE_PATTERNS` swallows it as a failure instead of an idempotent success.
* **Solution:** replace one-shot verification with bounded exponential-backoff
  polling against the registry metadata endpoint, and classify
  "already published / already staged" as success. Ported from the js template's
  `publish-retry.mjs` + `npm-registry.mjs` + `publish-failure-classifier.mjs`,
  **plus the E409 `previously staged version` pattern that the template is also
  missing** (see §7).
* **The Rust side is already correct:** `rust/scripts/publish-crate.rs`
  `classify_failure()` maps `already uploaded` / `already exists` to
  `FailureKind::AlreadyExists` and the workflow accepts
  `publish_result == 'already_exists'`. No change needed there; verified by
  reading the script and `analysis/rust-scripts-diff.log`.

### 4.2 FALSE NEGATIVE — Rust clippy warnings never fail the build

* **Site:** `.github/workflows/rust.yml` `Run Clippy` step; `rust/Cargo.toml`.
* **Root cause:** `cargo clippy --all-targets --all-features` without
  `-D warnings`, and `Cargo.toml` has no `[lints]` section. Clippy exits 0 while
  printing warnings, so CI is green with 15 outstanding warnings
  (`analysis/clippy-before.log`).
* **Solution:** add `-- -D warnings`, add `[lints.rust]` / `[lints.clippy]` to
  `rust/Cargo.toml` mirroring the Rust template, and fix every warning.

### 4.3 FALSE NEGATIVE — ESLint warnings never fail the build

* **Site:** `js/package.json` `"lint": "eslint ."`.
* **Root cause:** no `--max-warnings 0`. `js/eslint.config.js` sets ~15 rules to
  `warn`, so any regression under those rules passes CI silently.
* **Solution:** `eslint . --max-warnings 0`. The tree is currently clean, so the
  gate can be closed without churn and prevents future regressions.

### 4.4 FALSE NEGATIVE — the workflows themselves are never linted

* **Site:** `.github/workflows/` — there is no `workflows.yml`.
* **Root cause:** no actionlint and no zizmor job exists, so shell defects and
  workflow security defects reach `main` unreviewed. Baselines:
  actionlint 4 findings, zizmor 58 findings.
* **Solution:** add `.github/workflows/workflows.yml` (actionlint via the Docker
  image so shellcheck/pyflakes actually run, + zizmor with a repo config), plus
  `.github/zizmor.yml` and `.github/actionlint.yaml`, and fix every finding.

### 4.5 ERRORS/WARNINGS found by the new linters

| Tool | Finding | Sites |
| --- | --- | --- |
| actionlint | SC2193 — `[[ "..." == "changeset-release/"* ]]` comparison always false-ish form | `js.yml:73` |
| actionlint | untrusted `github.head_ref` interpolated into `run:` | `js.yml:73` |
| actionlint | SC2086 — unquoted `$GITHUB_OUTPUT` (×2) | `js.yml:251,252` |
| zizmor | `template-injection` ×9 | `js.yml:73,345,398`; `rust.yml:300,337` |
| zizmor | `excessive-permissions` ×10 | every job without `permissions:` in `js.yml`, `rust.yml` |
| zizmor | `unpinned-uses` ×39 | every `uses:` in `js.yml`, `rust.yml`, `parity.yml` |

### 4.6 FALSE NEGATIVE — no branch protection on `main`

`api/branch-protection.json` = `404 Branch not protected`; `api/rulesets.json` = `[]`.
Nothing prevents merging a PR whose checks are red. This is a repository
*setting*, not a file, so it cannot be fixed inside this PR; it is documented in
`docs/CI-CD.md` as a required manual step.

### 4.7 Concurrency model violates best practice #10

`js.yml` and `rust.yml` declare a **workflow-level** cancellable concurrency
group while the same workflow contains `release` / `instant-release` /
`changeset-pr` write jobs. A cancelled release can leave a committed version bump
without a published artifact. Best practice: cancellable groups only on check
jobs; a single non-cancellable `main-writer-*` group for every writer job.

### 4.8 `always()` instead of `!cancelled()`

`js.yml:85,115` and `rust.yml:78,111,146` use `if: always() && ...`, which keeps
jobs running after the run is cancelled. `!cancelled()` is the correct guard for
"run even though an upstream job was skipped".

### 4.9 FALSE POSITIVE risk — matrix job-name collision

`js.yml` names the test job `Test JavaScript (${{ matrix.runtime }} on ${{ matrix.os }})`
but the Node entries differ only by `matrix.node-version`. Result: three checks
all named `Test JavaScript (node on ubuntu-latest)`. Required-status-check rules
and humans cannot tell them apart, and a failure in one is indistinguishable
from a failure in another.

## 5. File-by-file comparison against both templates

Scripts (`analysis/js-scripts-diff.log`, `analysis/rust-scripts-diff.log`):

* `rust/scripts/` — 8 of 17 files byte-identical to the template. The 5 that
  differ are *ahead* of the template (e.g. `publish-crate.rs` uses
  `--manifest-path` instead of `cd`, which is strictly better) or repo-specific.
  Template-only scripts that matter for CI hygiene:
  `check-cargo-lock.rs`, `simulate-fresh-merge.sh`, `install-rust-script.sh`.
* `js/scripts/` — every shared file differs; the important structural gap is
  that the template splits publishing into `publish-retry.mjs`,
  `npm-registry.mjs` and `publish-failure-classifier.mjs` with unit tests, while
  this repo has a single monolithic `publish-to-npm.mjs` with the defect in §4.1.

Workflows — present in **both** templates, absent here:

| Template file | Purpose |
| --- | --- |
| `.github/workflows/workflows.yml` | actionlint + zizmor |
| `.github/workflows/security.yml` | CodeQL, dependency review, ecosystem audit |
| `.github/zizmor.yml` | `unpinned-uses` policy |
| `.github/actionlint.yaml` | known-runner-label allowlist |

## 6. Best practices applied from `CI-CD-BEST-PRACTICES.md`

1. Least-privilege `permissions:` at workflow level (`contents: read`) with
   per-job elevation only where a write is genuinely needed.
2. No `${{ }}` interpolation inside `run:` — every value passes through `env:`.
3. Third-party actions hash-pinned; trusted namespaces ref-pinned by policy.
4. `persist-credentials: false` on every `actions/checkout` that does not push.
5. Cancellable `check-*` concurrency for checks; single non-cancellable
   `main-writer-*` group for writers.
6. `!cancelled()` rather than `always()`.
7. Every job has `timeout-minutes`.
8. Workflow linting (actionlint **with shellcheck**) and workflow security
   auditing (zizmor) as first-class CI jobs.
9. Warnings are errors (`-D warnings`, `--max-warnings 0`).
10. Verification of published artifacts (`wait-for-npm.mjs`,
    `wait-for-crate.rs`) so a green release means an installable artifact.

## 7. Upstream issue to report

**Repository:** `link-foundation/js-ai-driven-development-pipeline-template`

`scripts/publish-retry.mjs` defines `ALREADY_PUBLISHED_PATTERNS` as:

```js
const ALREADY_PUBLISHED_PATTERNS = [
  'epublishconflict',
  'cannot publish over the previously published version',
  'cannot publish over previously published version',
  'you cannot publish over the previously published versions',
  'already published',
];
```

npm's real E409 message for a re-publish of a version whose tarball was already
staged is:

```
npm error code E409
npm error 409 Conflict - PUT https://registry.npmjs.org/<pkg> - Cannot publish over previously staged version "0.20.1"
```

`staged` ≠ `published`, so none of the patterns match, and `E409` is not handled
anywhere in the template (`grep -rn 'staged\|E409\|409' scripts/` → no hits).
A retry after a slow-propagating publish therefore fails the release even though
the version is live. Reproducible example, workaround and the code fix are in
the issue text (see §9 of the PR description).

## 8. Existing components / libraries surveyed

| Component | Used for |
| --- | --- |
| [`rhysd/actionlint`](https://github.com/rhysd/actionlint) 1.7.7 (Docker image) | Workflow syntax + embedded shellcheck/pyflakes. The Docker image is required: a bare binary without shellcheck on `PATH` silently skips shell checks. |
| [`zizmor`](https://docs.zizmor.sh/) via `zizmorcore/zizmor-action` | Workflow *security* audit — unpinned actions, template injection, excessive permissions, credential persistence. |
| [`github/codeql-action`](https://github.com/github/codeql-action) | Static analysis for `javascript-typescript` and `actions`. |
| [`actions/dependency-review-action`](https://github.com/actions/dependency-review-action) | Blocks PRs introducing high-severity advisories. |
| `npm audit --package-lock-only --audit-level=high` | Dependency advisories without a network install. |
| [`@changesets/cli`](https://github.com/changesets/changesets) | Already in use for versioning/publishing. |
| npm registry metadata endpoint (`https://registry.npmjs.org/<pkg>`) | Publication check that does not depend on `npm view`'s cache/replica behaviour. |
