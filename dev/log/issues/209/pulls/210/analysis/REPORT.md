# Issue 209 investigation and implementation

This archive supports [issue 209](https://github.com/link-foundation/command-stream/issues/209) and [PR 210](https://github.com/link-foundation/command-stream/pull/210). Investigation began from `5f718ea` on branch `issue-209-4043f0c126d5`, based on main `2344fee3ea05c0bdc70187b2920df88bce8bed8f`. All times below are UTC on 2026-10-05. Original evidence is retained separately from rerun attempts and local before/after results.

## Evidence and reproducibility

- `../github/`: issue body, all issue comments, all three PR comment types, PR/repository settings, branch rules, run and job metadata. There were no issue or PR comments at initial collection.
- `../ci-logs/`: compressed complete available workflow logs, and error responses where GitHub could not provide an archive. An unavailable historical log is an evidence limit, not evidence of successful tests.
- `../templates/`: full tracked-file archives, original trees, commit metadata, open upstream issues, and the referenced 16-principle CI/CD document.
- `*-complete-file-comparison.{json,csv}`: every tracked template file, SHA-256, size, CI relevance and adaptation decision. `local-ci-file-comparison.{json,csv}` inventories every local workflow/script and counterpart; `template-diffs/` preserves the actual differences.
- `../research/`: timestamped npm metadata/cache probes, npm's OIDC implementation, Pages HTTP verification, and current crates.io authentication/publish handlers.
- `../validation/`: local reproduction and verification logs. Files ending `before` deliberately contain failing assertions demonstrating the old behavior; these are not claims about final CI.
- `../upstream/`: exact report bodies and returned GitHub issue URLs.
- `../../../../../../experiments/issue-209/`: reusable collectors, template comparison, isolated Rust Git regressions, offline template preflight and Python probes, and a bounded live npm registry probe.

Read compressed evidence using `gzip -dc <file.log.gz> | nl -ba | sed -n '1,1500p'`, then subsequent 1500-line chunks. Run/job metadata must be checked against the commit being validated. Cache-busting REST queries are used when GitHub's cached run state differs from fresh job data.

## Complete requirements

| Requirement | Application / evidence |
| --- | --- |
| Investigate all nine referenced runs, including green runs | Original run/job metadata and available logs retained; warnings/security skips inspected rather than treating green as exhaustive validation. |
| Find false positives, false negatives, warnings and errors | Findings F1–F12 below include observed failures and latent defects reproduced with isolated tests. |
| Compare the entire JavaScript template first | 404 tracked files inventoried at `4c8644fb457b65933fcb19b033e60e7d0338f2ad404`; workflow/script diffs and upstream regressions preserved. |
| Compare the entire Rust template second | 162 tracked files inventoried at `e7d4a5bceb152f76d9fde77bae6751b835b9cdcd162`; transferred monorepo path policy, pinned tooling, release retry classification and credential handling. |
| Compare the entire Python template third | 101 tracked files inventoried at `1e2f475cb411e857f83f769f13887ae2df0656b2101`; transferable quality/security policy compared. There is no Python distribution in this repository, so PyPI release/version/build jobs do not apply. |
| Apply all 16 cited best practices | Principle-by-principle matrix below covers retained, repaired, and nonapplicable mechanisms with reasons. |
| Reuse appropriate existing implementations | Existing Changesets, Cargo/rust-script, native Git, actionlint, zizmor, secretlint, lychee and lockfile audits retained. Exact-version npm checks and longer verification budget follow the current JS template. |
| Report shared template defects | Six reports include pinned revisions, reproductions, workarounds and code suggestions; previously reported Rust tool/token warnings linked instead of duplicated. |
| Preserve all related data under the requested folder | Raw metadata, logs, complete template archives, diffs, research, report bodies and validation reside under `dev/log/issues/209/pulls/210`. |
| Reconstruct sequence and find actual causes | Timeline and finding-specific evidence distinguish confirmed facts, inferred cache involvement and unavailable Windows output. |
| Provide solutions and execution plans for every requirement | Each finding states options, selected remedy, verification and remaining limits. The execution checklist is `plan.md`. |
| Add debug/verbose output when evidence is insufficient | Bun console/JUnit artifacts and opt-in `COMMAND_STREAM_TRACE`/`CI_SCRIPTS_DEBUG` variables preserve next-run evidence; defaults remain off. CommonJS probe stderr is included on failure. |
| Fix every affected occurrence without removing features | Release mutation checks applied across JS scripts, both PR version/changelog guards hardened, every workflow runner/install reviewed, and Rust module exports preserved. |
| Reproduce before fixing and keep probes | Before logs for registry polling, metadata guards, audit transport errors, Cargo token arguments, size warnings, dependency-review skips and scope-aware preflight; permanent regression tests/experiments retained. |
| Keep work in this one PR, preserve history and release preparation | Existing PR 210 updated on the authorized branch; additive commits, no force push/direct main merge. New patch changeset and Rust fragment trigger automated versions without a manual package-version edit. |
| Validate locally and at latest branch commit | Full Bun, Node compatibility, Rust, formatting/lint/types/docs/parity/workflow/security checks captured; latest-SHA CI and final review recorded separately. |

## Timeline

| Time | Event | Evidence and implication |
| --- | --- | --- |
| 12:37 | Older main JS run 37310859834 starts at `7b7480e` | Related release failure predates the nine-run summary and was included to avoid limiting analysis to the two highlighted failures. |
| 12:41:08 | npm publish succeeds; registry polling starts | `run-37310859834.log.gz`, lines 31674–31688; seven attempts use the package-wide metadata visibility check. |
| 12:43:06 | Attempt 7 still sees no version and the release job fails | Same log, lines 31688–31690. The total wait budget is about two minutes. |
| 12:45:13.783 | npm metadata records publication of 1.4.0 | `npm-live-probe.json`: version timestamp is after the failed poll, confirming the release was eventually visible rather than a permanently missing package. Historical CDN headers were not recorded. |
| 13:19:35 | Link run 37315903872 reports the documentation URL as HTTP 404 | Original log lines 268 and 305. The link failure correctly detects a real missing site. |
| 17:00 | Seven cited workflows start at `ee5a84d` | Run/job metadata. Rust/quality/benchmarks/security/workflow lint are green, but Rust emits five size warnings and a security skip can still produce green. |
| 17:01:16 | Docs configure-pages fails with Pages site Not Found | Original docs log lines 450–451; repository Pages API also returns 404 and `has_pages=false`. |
| 17:19:40 | Issue 209 is created | Issue API timestamp. Its JS run is still in progress at collection time, not a passing run. |
| 17:32–17:34 | Pages enabled with build source `workflow`; original docs attempt 2 succeeds | `pages-configured.json`, `run-37345117246-attempt-2.json`, original and rerun logs. HTTP GET of the site returns 200. |
| 17:35:20 | Windows Bun job ends cancelled after its budget | Fresh run/job metadata: Windows started 17:00:20; Bun test step began 17:01:07; no completed test-step output is available from the historical archive. Other JS matrix jobs passed. |
| 17:35–17:36 | Original external link run attempt 2 succeeds | `run-37315903872-attempt-2.json`; same old source SHA now passes after the site exists, proving the setting/deployment root cause. |
| Investigation | Dependency compare API changes from 403 to 200 after vulnerability alerts are enabled | `dependency-graph-probe.*`, `vulnerability-alerts-enabled.*`, `dependency-graph-after.*`; final API response is `[]`, a valid successful comparison. |
| Investigation | Offline tests find template and local CI defects | Before/after logs and six upstream reports record exact behavior without publishing packages or using real credentials. |

## Findings, causes, solution options and completed plans

### F1: Missing Pages deployment and broken documentation link (confirmed configuration error)

The site was never enabled. `configure-pages` GET failed with 404, and the repository's advertised URL was therefore genuinely unavailable. Ignoring the URL in lychee would conceal this error. Options were administrator setup, privileged bootstrap automation, or removal of the promised website. Selected: enable Pages using the authorized repository administration API with source `workflow`; keep ordinary workflow permissions and check the setting before dependency installation. Rerun the original docs and link jobs and verify HTTP 200. Both original failures now pass at their original SHAs. `.github/DEPLOYMENT.md` records the setup procedure. No visual UI change was made.

### F2: npm release verification can fail after a successful publish (confirmed premature conclusion; cache contribution inferred)

The old seven-attempt budget ended 12:43:06; registry publication metadata is timestamped 12:45:13.783. A current package-wide probe also shows `Cache-Control: public, max-age=300`, while exact-version requests are dynamic. Historical cache headers are missing, so a specific CDN cache miss is not asserted as the sole historical cause. Options: increase polling only, use an exact-version uncached endpoint, or delegate all visibility decisions to npm CLI. Selected: native bounded `fetch` of `/<package>/<version>` with no-cache/cache-busting, strict identity/version validation, the current template's 34-attempt bounded backoff, and consistent use in release-needed, publish verification and wait-for-npm. Polling tolerates transient errors until the finite deadline, but release planning treats unexpected network/HTTP errors as errors rather than “unpublished.” Fake-clock tests prove eventual visibility after five minutes without real waits; mismatch, 404, 503 and transient polling cases are covered.

### F3: Windows Bun suite exhausts its job budget (confirmed symptom; root cause still unknown)

The historic Windows test step remained running until cancellation while Linux/macOS Bun and Node jobs finished. The directly recovered workflow ZIP contains six successful jobs but omits Windows; a fresh Windows job-log request returns 404. Windows output was unavailable, so neither a specific stuck test nor a product deadlock can responsibly be claimed. Options: increase the timeout, reproduce locally on Windows, or preserve bounded next-run diagnostics. Selected: leave a finite test-step budget inside a larger job budget, tee console output, write JUnit output, upload both on success/failure/cancellation, and expose existing runtime/script traces through default-off repository variables. A CommonJS probe also prints child stderr when it fails. The next Windows run determines whether further fixes are needed; archived metadata states the uncertainty explicitly.

### F4: Green Rust CI emits five real size warnings (confirmed)

Original Rust log lines 2778–2787 identify `version-and-commit.rs` (932), `small.rs` (915), `lexer.rs` (949), `io.rs` (910) and `lib.rs` (937), exceeding the 900-line warning threshold. Options: raise limits, suppress warnings, or extract coherent modules/tests. Selected: extract release/builtin/I/O tests, lexer token definitions and public run options. Root public re-exports preserve API behavior and documentation links. A five-case regression failed before and passes after extraction. Full Rust tests, doc tests and Clippy with denied warnings verify the refactor.

### F5: Release metadata guards can report false success or false failure (confirmed isolated reproductions)

Line-based version guards confuse reindentation with a semantic change; magic `release/*` names permit unauthorized manual version edits; swallowed Git errors resemble empty diffs. Existing fragment directory fallbacks and counting modified fragments let a PR reuse old release documentation. Options: patch regexes, require naming conventions, or compare parsed manifests against a verified merge base. Selected: JSON/TOML semantic comparisons, explicit failure for missing refs, no branch-name bypass, added-fragment-only checks and package-path-aware documentation exemptions. Rust code-change detection distinguishes a successful empty diff from a missing comparison. JS fixtures cover three version and three changeset cases; five isolated Rust Git cases cover the equivalent defects. CI executes these fixtures. Fresh-template differences are reported with exact pinned revisions, including cases already fixed upstream.

### F6: Release commands silently ignore failures or stage unrelated files (confirmed behavioral tests)

`command-stream` defaults to nonthrowing subprocess results; release helpers assumed a failed mutation would throw. `git add -A` could commit unrelated changes, and unrestricted push retries rebased on authentication/policy errors. Options: globally change shell behavior, wrap mutating commands, or rewrite release scripts with native subprocesses. Selected: explicit checked mutations across JS versioning/setup/release-note helpers, native allowlisted metadata staging including already staged/untracked paths, and bounded Git retries only for verified non-fast-forward races. Rust checks configuration/fetch/staging, classifies repository-rule errors before lost races and pushes only the newly created release tag. Temporary-repository tests reject unrelated files and already staged content; mocks prove command/push failures remain failures. Existing release modes and partial-release recovery remain supported.

### F7: Manual releases, parity exemptions and paths bypass useful validation (confirmed workflow regressions)

Manual release conditions could bypass successful checks; `parity-exempt` skipped the entire executable feature suite; benchmark triggers omitted runtime source paths. Options: remove manual modes/exemptions, duplicate checks, or narrow exemptions and express dependencies. Selected: manual validation on main, successful lint/test requirements for release writers, test/script stages after lint, paired-change exemption only, always-executed fresh-merge feature checks, and both source directories in benchmark triggers. YAML behavior tests fail old conditions and pass the repaired conditions. No previously supported runtime or manual release feature is removed.

### F8: Mutable runners/tool installs reduce reproducibility (confirmed inventory difference)

All workflows now use explicit OS images, the tested Rust script runner is installed as `rust-script 0.35.0 --locked`, Bun lockfiles use frozen installation, and actionlint uses the current template's immutable Docker digest. OS matrix coverage remains Linux/macOS/Windows. SDK stable/latest policies intentionally remain where broad consumer compatibility is being tested; registry/security schedules remain able to detect new advisories. Existing trusted-action granularity follows the repository's documented zizmor policy.

### F9: Security checks can turn missing evidence into green (confirmed)

The npm wrapper accepted an npm transport-error JSON response as an empty vulnerability report. Dependency review treated any 403 as disabled configuration and skipped the actual action while reporting success. Options: retain warnings and rely on other audits, or fail closed and repair configuration. Selected: reject npm error/invalid JSON tables, enable dependency graph, and run dependency review unconditionally for PRs. A stubbed npm EAI_AGAIN test and workflow skip regression fail before and pass after. npm/Bun/Cargo committed lockfile audits and secret scanning stay independent.

The existing narrowly named `GHSA-vfj7-8cjw-p6xm` ignore covers unpatched development-tool `braces` stack exhaustion, not shipped runtime dependencies. The upstream advisory reports no patched version. No unbounded memory/stack probe was run. Replacing the entire tooling stack solely to remove an unpatched development-only advisory is not justified here; the explicit existing exception remains visible instead of disabling audit severity. Future patched versions should remove it.

### F10: Preflight does not prove npm publishing access (confirmed upstream reproduction)

The JS template counted an OIDC environment variable as verified. The offline curl stub proves zero npm requests despite a green combined preflight. Selected: request the correct audience and actually exchange the identity for a package-specific npm token, discard it and fail on denied/malformed/network responses before package checks. npm CLI's current source confirms the exchange endpoint. No tokens are persisted or printed. PR jobs receive no publishing credentials; main/manual-main jobs authenticate in their first lint stage. Denied-exchange mock tests prevent a mere environment-presence check from regressing.

### F11: Cargo preflight uses a cookie-only endpoint (confirmed current upstream source)

The Rust template probes `/api/v1/me` with an API token, but the current crates.io handler uses `AuthCheck::only_cookie()`. Generic token metadata endpoints also reject scoped publish tokens. Copying this implementation would introduce false release failures. Options: nonempty-token validation (insufficient), `/me` (incorrect), or a deliberately incomplete request to the actual publish API. Selected: valid length-prefixed package/version JSON, with neither archive length nor archive. crates.io authenticates and checks publishing/target scopes and verified email before reading the archive length. Accept only HTTP 400 with exactly `invalid tarball length`; other responses fail closed. The request cannot publish a crate. Current upstream handler copies and structural/error mock tests are archived. Actual publication remains the authoritative ownership check because ownership is validated later; team ownership continues to work. Local authenticated success cannot be tested without CI release credentials and is not claimed.

### F12: Timing-based streaming test fails despite streaming (confirmed local false positive)

The complete local suite observed first output at 61 ms and failed a hardcoded 50 ms Unix startup limit. Increasing a timeout would still assume machine speed. Selected: child emits its first output and waits for input; the consumer asserts the child is unfinished before releasing it. This proves live streaming causally, with a finite child/test budget, independent of runner startup speed. The old failure and the passing revised test are preserved. A separate one-off CommonJS child failure did not reproduce in isolation; stderr diagnostics now preserve its actual cause if it recurs.

## All 16 CI/CD principles

| # | Principle | Applied mechanism and scope |
| --- | --- | --- |
| 1 | Trigger relevance | Language paths retained; both runtime source trees trigger benchmarks; repository-wide quality/security and scheduled external checks intentionally see shared changes. |
| 2 | File size | JS/Rust 1000-line ceilings retained; all five >900-line Rust warnings removed by extraction and regression checks. |
| 3 | Formatting | Prettier and Cargo fmt remain enforced; pre-commit formatting retained. Evidence archives are excluded from source-format gates by the existing archive policy. |
| 4 | Static analysis | ESLint `--max-warnings 0`, TypeScript, Clippy/rustdoc/Rust denied warnings, CodeQL and duplicate-code limits retained. |
| 5 | Fail fast | PR metadata checks precede lint; test/Rust script/build jobs require lint success. Publishing credentials and Pages configuration are checked before expensive work. |
| 6 | Changeset versioning | One newly added JS fragment for code changes; added Rust changelog fragments; semantic version guards with failed-ref rejection. Automated patch release fragments included, no manual version change. |
| 7 | Actual merge | Existing merge simulation retained in tree-reading jobs; parity exemption no longer bypasses it. CodeQL uses GitHub's registered merge SHA because uploads reject synthetic commits; dependency review compares API SHAs without reading the tree. |
| 8 | Pre-commit hooks | Existing Husky/lint-staged workflow retained and used for atomic commits; equivalent CI checks remain mandatory. |
| 9 | Releases | Explicit checked mutations, minimal staged metadata, verified publication, idempotent partial-release checks and fail-closed planning. |
| 10 | Concurrency | Per-job cancellable `check-*` groups and shared noncancellable repository release writers retained; retry only proven Git lost races. |
| 11 | Secret detection | Pinned secretlint remains tree-wide; credentials never appear in child Cargo argv or preflight diagnostics; collected HTTP headers are sanitized. |
| 12 | Documentation | Generated docs and executable feature catalog validated; Pages configuration repaired; external link 404 fixed by deployment rather than an ignore rule. |
| 13 | Native multiarchitecture containers | No product container image, Helm chart or app bundle is published. Linux/macOS/Windows library testing applies; adding unrelated Docker publishing would create a new product rather than repair CI. |
| 14 | Workflow lint | Both actionlint (immutable tested image digest) and zizmor with existing publisher-pin policy run locally and in CI. |
| 15 | Dependency audit | npm/Bun and both Cargo lockfiles audited; transport/malformed responses fail; dependency graph enabled and review cannot skip to green. Existing named unpatched development-only advisory exception stays explicit. |
| 16 | Publishing proof | Authenticated package-specific npm exchange and scope-aware incomplete Cargo publish probe run before package checks. Public metadata is used independently to verify visibility after publishing. Secrets are main-only; ownership is finally proven by the actual publish. |

## Existing components and alternatives researched

- [Changesets](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md) already provides JS fragments, collection and publishing; keep it, improve the PR guard and explicit command-result handling. Documentation-only changes need not force a release.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm CLI OIDC code](https://github.com/npm/cli/blob/latest/workspaces/libnpmpublish/lib/oidc.js) provide the package-specific exchange protocol. Native fetch suffices for small checks; no third-party CDN module loader is needed in release planning.
- [Cargo publishing](https://doc.rust-lang.org/cargo/commands/cargo-publish.html) supports registry credentials in environment variables. Use that existing mechanism instead of exposing tokens in Cargo child arguments.
- [actionlint](https://github.com/rhysd/actionlint/blob/main/docs/usage.md), [zizmor](https://docs.zizmor.sh/usage/) and [secretlint](https://github.com/secretlint/secretlint) already solve workflow syntax/security and credential scanning; retain complementary coverage and pinned versions/policies.
- [lychee](https://lychee.cli.rs/) provides external link validation; the failing Pages link was accurate and needed a deployed destination.
- [Scriv](https://scriv.readthedocs.io/en/latest/) is appropriate for Python fragment collection in the Python template. This repository has helper Python scripts but no Python package to release.
- [GitHub Pages REST setup](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site) and [vulnerability alert enablement](https://docs.github.com/en/rest/repos/repos#enable-vulnerability-alerts) provide the required repository configuration fixes; these are administrator settings, not workflow permission workarounds.
- [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no fixed release. The existing narrowly scoped development-only exception is retained with honest evidence.

## Upstream reports

- JS semantic version guard: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/205
- JS CI changeset fallback: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/206
- JS unproven OIDC preflight: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/207
- Rust version/fragment guards: https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/182
- Rust cookie-only Cargo preflight: https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/183
- Python documented/enforced fragment contract: https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/93
- Existing Rust template reports 177–181 cover deprecated token argv, missing tool tests, pinned rust-script/OS and Cargo warnings; do not duplicate them. Applicable token/pin/size fixes are included locally.

## Validation and limits

`../validation/` preserves full test output, not just counts. Final run metadata/logs are collected after push and checked against the current branch SHA in `VALIDATION.md`. Tests intentionally failing against original/template implementations are labeled `before`. No real package publication was performed locally. Historical Windows output and successful live release-secret authentication are explicit evidence limits, with bounded artifacts/default-off diagnostics and real main-workflow gates to provide next-iteration data.
