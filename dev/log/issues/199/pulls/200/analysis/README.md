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
| R1 | Check for **all false positives** in CI/CD and fix them | §4.1, §4.9, §4.13, §4.17, §4.21, §4.22 |
| R2 | Check for **all false negatives** in CI/CD and fix them | §4.2, §4.3, §4.4, §4.6, §4.10, §4.11, §4.16, §4.17, §4.18, §4.19, §4.20, §4.23 |
| R3 | Check for **all warnings** in CI/CD and fix them | §4.2, §4.3, §4.5, §4.16 |
| R4 | Check for **all errors** in CI/CD and fix them | §4.1, §4.5, §4.12, §4.14, §4.15 |
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

### 4.10 FALSE NEGATIVE — the duplication gate analysed zero files

`.jscpd.json` carried `"format": "console"`. In jscpd, `format` is the list of
**languages** to analyse, not the reporter: `@jscpd/finder` filters every
candidate with `options.format.includes(detectedLanguage)`. No file's language
is `console`, so the detector matched nothing:

```
"format": "console"     -> exit 0, 0 clones, 0 files analysed
"format": ["javascript"] -> exit 1, 1 clone,  2 files analysed
```

Reproduction: `experiments/jscpd-format/run.mjs`. With the correct language list
the repository reports 65 files / 47 clones, 4.84 % of lines and 5.55 % of
tokens duplicated. `threshold` was `0`, which the check had never had to honour;
turning the gate on at `0` would have failed on the existing code rather than on
a regression, so it is set to `6` — just above today's measurement, so any
increase in duplication fails the job. `js/tests/duplication-check.test.mjs`
asserts the threshold stays in that range, so the gate cannot be disabled by
raising it. The same `format` defect is in the JavaScript template — reported
upstream (§7).

### 4.11 FALSE NEGATIVE — half the repository was outside the lint base path

`eslint.config.js`, `.prettierrc`, `.prettierignore` and `.lintstagedrc.json`
lived in `js/`. Both tools treat the directory holding their configuration as
the project base path, so repository-root JavaScript (`claude-profiles.mjs`,
`experiments/**`) was reported as "ignored because it is located outside of the
base path" and was silently never linted; lint-staged likewise only considered
files under `js/`. `js/.prettierignore` also listed
`docs/case-studies/**/{data,templates}/**`, which resolved against `js/`:
`js/docs/case-studies` has no `data/` or `templates/` subdirectory, and the
archived upstream copies those rules exist to protect live under the
repository-root `docs/case-studies` — outside prettier's reach entirely. The
configs now live at the root and `js/eslint.config.js` remains the rule set they
re-export.

### 4.12 ERROR — nothing audited dependencies or analysed sources

There was no security workflow at all: no dependency advisory check for any of
the three lockfiles, no static analysis, no scheduled re-run. `cargo audit`
found a live advisory on the first run:

```
RUSTSEC-2026-0007  bytes 1.11.0  integer overflow in BytesMut::reserve
```

Fixed by `cargo update -p bytes` (1.12.1). `npm audit` and `bun audit` were
cleared by the dev-dependency refresh. `.github/workflows/security.yml` now runs
CodeQL (`javascript-typescript`, `rust`, `actions`, all with `build-mode: none`),
dependency review, and the three audits, weekly as well as per push and pull
request — a lockfile that is clean today is not clean in a month.

### 4.13 FALSE POSITIVE — zizmor audited archived evidence

The first CI run of the Zizmor job reported 30 findings, all in `release.yml` —
a file `.github/workflows/` does not contain. `zizmorcore/zizmor-action` defaults
to `inputs: .`, walking the whole tree and collecting the 14 verbatim copies of
other repositories' workflows archived under `docs/case-studies/**/templates/**`.
Those never execute here and editing them would falsify the evidence they exist
to preserve, so the audit is scoped to `.github/workflows` and the scope is
pinned by a test.

### 4.14 ERROR — dependency review cannot run on this repository

```
Dependency review is not supported on this repository. Please ensure that
Dependency graph is enabled
```

`GET /repos/link-foundation/command-stream` returns no `dependency_graph` key
under `security_and_analysis`; the compare endpoint returns `403 Forbidden` and
the SBOM endpoint `404 Not Found`. A `PATCH` with
`security_and_analysis[dependency_graph][status]=enabled` was accepted but had
no effect — the setting is controlled at the organisation level and could not be
changed from here.

**Manual step required:** enable the dependency graph at
<https://github.com/link-foundation/command-stream/settings/security_analysis>.

Until then the job probes the compare endpoint and skips with a warning on 403,
rather than failing forever. A check that can only ever be red is itself a false
positive: it teaches reviewers to ignore red. Any status other than 200 or 403
still fails the job, and the review starts running by itself once the graph is
on. The three audit jobs cover the committed lockfiles in the meantime.

### 4.15 ERROR — a publish token was handed to every pull-request job

`rust.yml` declared `CARGO_REGISTRY_TOKEN` in the workflow-level `env:`. That
block is inherited by every job, so the crates.io token was in the environment of
`cargo test` and `cargo clippy` on `pull_request` — both of which compile and run
code from the branch under review, via `build.rs`, proc macros or the tests
themselves. Publishing credentials now sit on the publishing job only, and a
test asserts no workflow-level `env:` value references `secrets.`. The same
defect is in the Rust template — reported upstream (§7).

### 4.16 FALSE NEGATIVE — two warnings that only exist off Linux

Denying warnings surfaced two defects the pipeline had never been able to see,
both of which failed the Rust job on `a00126b`:

- `tests/cd_invocation_isolation.rs`: `output_env` is read only by the
  `#[cfg(unix)]` assertions, because the dump it parses comes from
  `/usr/bin/env`. On Windows it was an unused function and the test crate would
  not compile. Confirmed both ways with
  `cargo check --target x86_64-pc-windows-msvc --all-targets`.
- `scripts/version-and-commit.rs`: `rust-script --test` builds the script as a
  test harness, where `main` is not the entry point, so the twelve helpers
  reachable only from `main` are unreferenced — exactly the twelve errors CI
  reported. The imports were already gated on `not(test)` for the same reason.
  `#![cfg_attr(test, allow(dead_code))]` covers the test build; the real build
  still denies dead code.

The second one exists in the Rust template too, where it is invisible because
nothing there runs the script suites at all — reported upstream (§7).

### 4.17 FALSE NEGATIVE — repository-wide checks were hidden behind `paths:` filters

`js.yml` ran on `js/**`, `rust.yml` on `rust/**`, `workflows.yml` on
`.github/**`, `parity.yml` on both source trees. The union of those filters is
not the repository, so a pull request touching only `docs/**` matched no
workflow and ran **nothing at all**. Worse, three checks that read the whole
tree lived behind the `js/**` filter:

* `format:check` runs prettier from the repository root over every tracked file,
* `workflow-hygiene.test.mjs` parses `.github/workflows/*`,
* the documentation checks added for §4.20.

A formatting violation introduced in a workflow file or a markdown document
therefore first turned red on the next unrelated JavaScript pull request — the
textbook false positive: a red check on a change that did not cause it.

Fix: `quality.yml`, deliberately without a `paths:` filter, runs those three
checks on every pull request; `js.yml`'s filter gained the root-level files
eslint reaches (`eslint.config.js`, `claude-profiles.mjs`, `experiments/**`);
and two hygiene invariants keep it that way — every file eslint lints outside
`js/` must appear in `js.yml`'s trigger, and a workflow's `push:` and
`pull_request:` filters must be identical, so a green pull request keeps
predicting a green `main`.

### 4.18 FALSE NEGATIVE — three shipped quality gates were never invoked

`rust/scripts/` contained `check-file-size.rs`, `check-crate-size.rs` and
`check-version-modification.rs`. No workflow, script or document referenced any
of them (`grep -rn` across the tree returned only their own definitions), so the
pipeline reported "all checks passed" for gates that never ran — including the
file-size limit that best practice #2 requires and that eslint already enforces
on the JavaScript side. `rust.yml` now runs all three, and a hygiene test fails
when a script under `rust/scripts/` is neither referenced by a workflow nor
listed as a documented exception.

### 4.19 FALSE NEGATIVE — nothing scanned the tree for committed credentials

Best practice #11. CodeQL does not look for secrets, and the audit jobs only
read lockfiles, so a committed credential would have reached `main` unnoticed.
`security.yml` now runs secretlint with the recommended preset over every file
on each pull request; `.secretlintrc.json` holds the rule set and
`.secretlintignore` only generated trees — a hygiene test rejects any ignore
pattern outside `node_modules/`, `rust/target/` and `js/{reports,coverage}/`.

### 4.20 FALSE NEGATIVE — documentation was never validated

Best practice #12. `js/tests/docs-validation.test.mjs` now enforces the
2500-line ceiling, resolves every relative link in every authored markdown file
and checks that the documents other automation points readers at still carry
their sections. It found two real breakages on the first run: two case-study
links pointed at release markers the release process had consumed, and one
pointed one directory level too high.

### 4.21 FALSE POSITIVE/NEGATIVE — the checks validated a stale merge preview

Best practice #7. A `pull_request` run checks out `refs/pull/N/merge`, computed
when the branch was last synchronised. If `main` moved since, every check
validated a combination that will not exist after the merge — green pull
request, broken `main`. Every pull-request job that reads the tree now runs
`.github/scripts/simulate-fresh-merge.sh` first, which also turns a merge
conflict into a clear failure instead of a surprise at merge time. Five jobs are
exempt with the reason recorded next to them and in the hygiene test
(`changeset-check`, the Rust changelog checks and `parity` are diff-based;
`dependency-review` compares two SHAs through the API; CodeQL uploads results
keyed to a commit GitHub has to know).

### 4.22 FALSE POSITIVE — a link checker on pull requests reports 20 unfixable errors

Best practice #12 names `lychee`, and both templates run it as a pull-request
gate. Copying that verbatim would have imported a false-positive generator. A
run over this tree (`lychee-run.log`):

```
🔍 114 Total 🔗 73 Unique ✅ 94 OK 🚫 20 Errors
```

All 20 are links that are correct in the document and unreachable from a
runner — npmjs.com answers `403` to any non-browser client (verified with
`curl -A 'Mozilla/5.0'`, still 403) and GitHub serves the stargazers list and
`/settings/` pages only to a signed-in session (`404` anonymously, even though
the repository is public). Including the archived trees adds five more, from a
verbatim copy of hive-mind's own best-practices document whose links point into
the repository it came from.

The split is by who can break the link. Relative links — the only ones a change
here can break — are resolved offline on every pull request (§4.20). External
links are fetched weekly and on demand by `links.yml`, whose failure means a
link that used to work has stopped working and blocks no merge.
`.lycheeignore` records the known-unreachable URLs, one commented entry each,
and with it the same run reports `0 Errors, 20 Excluded`
(`lychee-with-ignore.log`).

### 4.23 FALSE NEGATIVE — the new checks validated nothing on Windows

Found by the Windows leg of the matrix on run 33930261205:

```
(fail) documentation validation > the file list is not empty ... Expected: > 20, Received: 0
(fail) every file eslint lints outside js/ triggers the lint job ... Received [""]
```

`execSync("git ls-files '*.md'")` goes through the platform shell. `/bin/sh`
strips the single quotes; `cmd.exe` does not, so git looked for a path literally
named `'*.md'`, matched nothing and exited 0 — the documentation checks were
validating an empty list. `execFileSync('git', ['ls-files', '*.md'])` uses no
shell, so git expands the pattern itself everywhere.
`experiments/git-ls-files-quoting.mjs` reproduces both behaviours on Linux:

```
execSync, shell strips the quotes (POSIX): 37 file(s)
execSync, quotes reach git (what cmd.exe does): 0 file(s)
execFileSync, no shell at all: 37 file(s)
```

Only the assertion that the list is non-empty made this visible, which is the
argument for writing that assertion into every check that discovers its own
inputs.

### 4.24 FALSE NEGATIVE — the workflow audit could not see credential persistence

Found while writing the upstream report for the JavaScript template (§7, #160)
and then checked here, because the same setting had been copied over. zizmor's
`artipacked` audit — a checkout that leaves the job token in `.git/config`,
where any later step or uploaded artifact can read it — is a **Low**-confidence
check, and the job ran with `min-confidence: medium`. Every finding of that
class was therefore invisible:

```
zizmor --config .github/zizmor.yml --min-confidence medium .github/workflows -> No findings
zizmor --config .github/zizmor.yml --min-confidence low    .github/workflows -> 6 findings, all artipacked
```

All six are the release jobs, which push to `main` and publish, so they do need
the credential. The fix is not to silence them again by raising the threshold:
the job now runs at `--min-confidence low`, the six carry an inline
`ignore[artipacked]` next to the reason, and two hygiene tests hold the line —
every `actions/checkout` in every workflow either sets
`persist-credentials: false` or carries that suppression, and the number of
suppressions is asserted, so a seventh cannot arrive by copy-paste.

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
| `.github/workflows/links.yml` | lychee link check |
| `.github/scripts/simulate-fresh-merge.sh` (js) / `scripts/simulate-fresh-merge.sh` (rust) | merge the base branch before checking |
| `.secretlintrc.json`, `.secretlintignore` | committed-credential scan |

All of them are now present here, with two deliberate divergences, both recorded
in `docs/CI-CD.md` and enforced by the hygiene test:

* **`links.yml` runs weekly, not on pull requests** (§4.22). Both templates gate
  merges on it; on this tree that gate reports 20 errors that no change here can
  fix.
* **zizmor's input is `.github/workflows`, not `.`** (§4.13), because this
  repository archives other projects' workflows under `docs/case-studies/`.

Two defects in the templates' own copies of these files were reported upstream
(§7): the js template's `links.yml` `paths:` filter omits the very files the job
reads, and its zizmor job runs at `min-confidence: medium`, which hides the
`artipacked` findings for all 25 of its checkouts that persist credentials.

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
11. #7 *Validate the actual merge result* — every pull-request job that reads
    the tree merges the base branch first
    (`.github/scripts/simulate-fresh-merge.sh`), so a green pull request is a
    statement about what `main` will contain; the five diff- or API-based jobs
    that must not are exempt with the reason recorded (§4.21).
12. #11 *Secrets detection* — secretlint with the recommended preset over every
    file on each pull request (§4.19).
13. #12 *Documentation validation* — size ceiling, relative-link resolution and
    required-section checks offline on every pull request, external links
    weekly (§4.20, §4.22).
14. Repository-wide checks run without a `paths:` filter (`quality.yml`), and a
    workflow's `push:` and `pull_request:` filters must be identical, so no
    change class is left unchecked and a green pull request keeps predicting a
    green `main` (§4.17).
15. Every shipped quality gate is invoked by a workflow, or listed as
    deliberately unwired (§4.18).

## 7. Upstream issues reported

Three defects found here also exist in the templates the issue asks to compare
against, so each was reported with a reproducible example, a workaround and the
code-level fix:

| Issue | Repository | Defect |
| --- | --- | --- |
| [#157](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/157) | js template | `.jscpd.json` `"format": "console"` makes the duplication check analyse zero files and always pass (§4.10) |
| [#158](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/158) | js template | `publish-retry.mjs` misses npm's E409 "Cannot publish over previously staged version", turning successful releases into failed jobs (§4.1) |
| [#149](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/149) | rust template | `release.yml` puts `CARGO_REGISTRY_TOKEN`/`CARGO_TOKEN` in the workflow-level `env:`, handing the publish token to seven jobs that compile pull-request code (§4.15) |
| [#150](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/150) | rust template | No workflow runs `rust-script --test`, so 78 tests across 9 scripts never execute; `create-github-release.rs` does not compile in test mode and `version-and-commit.rs` fails under the template's own `RUSTFLAGS: -Dwarnings` (§4.16) |
| [#159](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/159) | js template | `links.yml`'s `paths:` filter omits `.lycheeignore` and `scripts/check-web-archive.mjs`, so editing the ignore list or the archive helper does not re-run the job that reads them |
| [#160](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/160) | js template | 25 of 27 checkouts persist credentials, and `min-confidence: medium` hides every `artipacked` finding (it is a Low-confidence check), so the audit reports 3 findings instead of 28 |

Checked and deliberately **not** reported, because they are correct as written:
the Rust template's `pipeline-status: if: always()` (it intentionally reports
cancelled jobs), matrix job names that omit a `runner` key when another key
already disambiguates them, and the JavaScript template's three low-confidence
`self-repository` zizmor findings. Two more were tested and dropped:

* the js template's `secretlint "**/*"` runs after `npm install`, but with a
  131 MB `node_modules/` present the exact command finishes in 19 s with zero
  findings, so there is nothing to report;
* both templates' `if: always() && steps.lychee.outputs.exit_code != 0` is
  redundant rather than wrong — when the step is skipped the output is `''` and
  `'' != 0` is false — and the js template's own
  `tests/links-workflow.test.js` asserts that exact string, so changing it would
  break its test suite for no behavioural gain.

### Detail: #158

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
| [`secretlint`](https://github.com/secretlint/secretlint) + `@secretlint/secretlint-rule-preset-recommend` | Committed-credential scan (best practice #11). Chosen over gitleaks/trufflehog because it needs no extra toolchain in a repository that already runs npm, and its ignore file is reviewable text. |
| [`lychee`](https://lychee.cloudflare.dev/) via `lycheeverse/lychee-action` | External link checking, weekly rather than per-pull-request (§4.22), with `.lycheeignore` for endpoints that answer only to a browser session. |
| `git ls-files` via `execFileSync` | Input discovery for the documentation and hygiene tests. Deliberately not a glob library: git already knows what is tracked, and going through a shell is what broke it on Windows (§4.23). |
