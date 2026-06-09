# Case study — Issue #166: "Latest `js-v0.10.1` release is a false positive, there is no actual release on npm"

> Issue: <https://github.com/link-foundation/command-stream/issues/166>
> Pull request: <https://github.com/link-foundation/command-stream/pull/168>

## 1. Executive summary

The `release` job of `.github/workflows/js.yml` created GitHub releases
`js-v0.9.6`, `js-v0.10.0`, and `js-v0.10.1` even though **none of those versions
were ever published to npm**. The latest npm version is `0.9.5`.

There are **three independent root causes**, and they compounded:

1. **The actual publish failed** with `npm error 404 … PUT
   https://registry.npmjs.org/command-stream - Not found`. This started the
   moment the release workflow file was renamed from `release.yml` to `js.yml`
   (commit `4986477`, "separate JavaScript and Rust package roots"). npm
   **trusted publishing (OIDC) allows only one workflow file** to be registered
   as a package's trusted publisher; the registered file was `release.yml`, so
   OIDC tokens minted from `js.yml` no longer matched and npm rejected the
   `PUT` with a `404`.

2. **The failure was reported as success** — the false positive. `js/scripts/publish-to-npm.mjs`
   ran the publish with a bare `` await $`bun run changeset:publish` `` inside a
   `try/catch`. But **command-stream's `$` does not throw on a non-zero exit
   code** (errexit is off by default — see issue #156). The `catch` therefore
   never fired, the script printed `✅ Published …` and wrote `published=true`
   to `$GITHUB_OUTPUT`, and the `Create JavaScript GitHub Release` step (gated
   on `steps.publish.outputs.published == 'true'`) created a release for a
   version that does not exist on npm.

3. **A restart "failed to do any deploy"** — the self-heal gap. After the
   false positive was reported, a CI re-run
   ([run 27224046292](https://github.com/link-foundation/command-stream/actions/runs/27224046292))
   still produced **no deploy at all**. By then the version bump (`0.10.2`) had
   already been committed to `main` and the changeset consumed, so `changeset
   version` reported `No unreleased changesets found, exiting`, the version step
   committed nothing, and the publish step — gated only on "did the version step
   commit?" — was skipped. The committed `0.10.2` was stranded forever above
   npm's `0.9.5`, with no path to ever publish it.

This PR fixes causes **#2 and #3 fully** (so the pipeline can never again create
a release without an actual npm publish, and a committed-but-unpublished version
self-heals on the next push) and **documents cause #1** with the exact fix the
package owner must apply on npmjs.com (cause #1 lives in external npm
configuration and cannot be fixed from inside the repository).

## 2. Timeline / sequence of events

All times UTC, 2026-06-08/09.

| Time | Event | npm? |
|------|-------|------|
| 06-08 12:30 | `0.9.5` released — **last release under `release.yml`** | ✅ on npm |
| 06-08 13:25 | Commit `4986477` "separate JavaScript and Rust package roots" splits `release.yml` → `js.yml` + `rust.yml` | — |
| 06-08 20:23 | `js-v0.9.6` GitHub release created (run under `js.yml`) | ❌ **not on npm** |
| 06-09 14:32 | `js-v0.10.0` GitHub release created | ❌ **not on npm** |
| 06-09 14:38 | `js-v0.10.1` GitHub release created (run [27213712924](https://github.com/link-foundation/command-stream/actions/runs/27213712924), job `80349831936`) | ❌ **not on npm** |
| 06-09 ~16:5x | Issue #166 filed | — |
| 06-09 (restart) | CI re-run [27224046292](https://github.com/link-foundation/command-stream/actions/runs/27224046292) — `0.10.2` already committed, changeset consumed → **no deploy at all** (cause #3) | ❌ **still 0.9.5 on npm** |

The decisive evidence is in [`ci-logs/run-27213712924-false-positive-smoking-gun.txt`](ci-logs/run-27213712924-false-positive-smoking-gun.txt):

```
Publish attempt 1 of 3...
$ changeset publish
🦋  info command-stream is being published because our local version (0.10.1) has not been published on npm
🦋  error an error occurred while publishing command-stream: E404 Not Found - PUT https://registry.npmjs.org/command-stream - Not found
🦋  error npm error 404 Not Found - PUT https://registry.npmjs.org/command-stream - Not found
error: script "changeset:publish" exited with code 1
✅ Published command-stream@0.10.1 to npm      ←  FALSE POSITIVE
```

`changeset publish` exited with code **1**, yet the very next line claims
success. The GitHub release was then created from that false output.

The restart (cause #3) is captured in
[`ci-logs/run-27224046292-failed-deploy-excerpt.txt`](ci-logs/run-27224046292-failed-deploy-excerpt.txt):

```
Found 1 JavaScript changeset file(s)
🦋  warn No unreleased changesets found, exiting.
No changes to commit
```

The `Release JavaScript package` job's step list for that run contains **no
`Publish to npm` step output** — the publish was gated off because the version
step committed nothing, so `0.10.2` never even attempted to reach npm.

## 3. Requirements extracted from the issue

| # | Requirement | Status |
|---|-------------|--------|
| R1 | Fix the false-positive release (`js-v0.10.1` with no npm release) | ✅ Fixed (`publish-to-npm.mjs`) |
| R2 | Check for **all** false positives / errors across CI jobs | ✅ Audited; `create-github-release.mjs` and `version-and-commit.mjs` hardened too |
| R3 | Compare against the 4 pipeline templates; reuse best practices; report upstream if templates share the bug | ✅ §5 |
| R4 | Download all related logs/data into `docs/case-studies/issue-166/` | ✅ [`ci-logs/`](ci-logs/) |
| R5 | Deep case-study analysis: timeline, requirements, root causes, solutions, existing components | ✅ this document |
| R6 | If not enough data for root cause, add debug/verbose output | ✅ Root cause found; the new script also logs full publish output + a diagnostic hint on failure |
| R7 | Report issues to related repos with reproducible examples / fixes | ✅ §5 — template latent issue reported |
| R8 | Apply the fix everywhere the problem occurs (whole codebase) | ✅ §4.4 audit + fixes |
| R9 | Prepare a release trigger (changeset) | ✅ changeset added |

## 4. Root-cause analysis

### 4.1 Cause #1 — the publish actually failed (`E404` on `PUT`)

npm **trusted publishing** uses GitHub OIDC. When you configure trusted
publishing for a package on npmjs.com you bind it to a single repository **and a
single workflow file path** (e.g. `.github/workflows/release.yml`). At publish
time npm validates the OIDC token's `job_workflow_ref` claim against that bound
path.

`command-stream` published fine through `0.9.5` while the workflow was
`release.yml`. Commit `4986477` renamed the JS release workflow to `js.yml`.
From that point the OIDC claim was
`…/.github/workflows/js.yml@refs/heads/main`, which no longer matches the
registered `release.yml`, so npm refuses the publish. npm deliberately returns
`404 Not Found` (rather than `403`) for unauthorized `PUT`s so it does not leak
whether a package exists.

This is confirmed by the timeline: every release **after** the rename is missing
from npm; the last release **before** the rename is present.

> Note: the masked `NODE_AUTH_TOKEN: XXXXX-XXXXX-XXXXX-XXXXX` line in the log is
> the placeholder `actions/setup-node` writes into `.npmrc`; it is not the
> cause. The publish path here is OIDC trusted publishing, not token auth.

**This cannot be fixed from inside the repo** — it requires a settings change on
npmjs.com. See §6 for the exact fix.

### 4.2 Cause #2 — the failure was reported as success (the false positive)

`command-stream`'s `$` returns a result object `{ code, stdout, stderr }` and
**does not throw / reject on a non-zero exit** (errexit defaults to `false`,
documented under issue #156). The old publish loop:

```js
try {
  await $`bun run changeset:publish`;   // never throws, even on exit code 1
  setOutput('published', 'true');       // ← always runs
  console.log(`✅ Published …`);
  return;
} catch (error) { /* unreachable on command failure */ }
```

Because the `catch` is unreachable for a failed command, `published=true` is
emitted unconditionally whenever the version is not already on npm. The release
step is gated only on that output, so it created the bogus release.

Reproduced locally and captured in the regression test
([`js/tests/publish-to-npm.test.mjs`](../../../js/tests/publish-to-npm.test.mjs)).
Against the **old** script a failing `changeset:publish` yields:

```
published=true
published_version=99.99.99-issue166-test     (exit code 0 — false positive)
```

### 4.3 Why the existing retry/`catch` logic looked correct but wasn't

The author's mental model assumed `$` behaves like `execa`/`zx` (throw on
non-zero) or like `bash -e`. command-stream intentionally does the opposite for
ergonomics. The pre-existing version-check in the same file already used the
correct pattern — `` await $`npm view …`.run({ capture: true }) `` and a
`checkResult.code === 0` test — but the publish path did not.

### 4.4 Codebase-wide audit (R2, R8)

Every script that makes a CI decision based on a command result was reviewed for
the "assumed `$` throws" anti-pattern:

| Script | Pattern | Verdict |
|--------|---------|---------|
| `js/scripts/publish-to-npm.mjs` | bare `await $` publish, success assumed in `try` | **BUG → fixed** (multi-layer detection) |
| `js/scripts/create-github-release.mjs` | bare `` await $`gh api … releases` `` POST, no code check | **Latent false positive → fixed** (checks `result.code`) |
| `js/scripts/version-and-commit.mjs` | bare `` await $`git push origin main` ``, then `version_committed=true` | **Latent false positive → fixed** (checks `result.code`) |
| `js/scripts/setup-npm.mjs` | `npm install -g` then re-reads version via `.run({capture})` | OK — a failed install surfaces later; no false success emitted |
| `js/scripts/format-github-release.mjs`, `format-release-notes.mjs` | `gh api … PATCH` formatting | Cosmetic; a failure does not gate a release. Left as-is |
| `rust/scripts/publish-crate.rs` | Rust `Command`, checks `output.status.success()` | OK — Rust reports exit status and the script checks it |

The two latent false positives (`create-github-release.mjs`,
`version-and-commit.mjs`) are in the **same job chain** as the reported bug and
are now hardened so the whole release path fails loudly instead of silently.

### 4.5 Cause #3 — the restart that "failed to do any deploy" (self-heal gap)

Once `0.10.2` had been bumped, committed to `main`, and its changeset consumed,
the release job's publish step had no trigger to fire. The publish was gated
only on the version step having committed a change:

```yaml
# before
if: steps.version.outputs.version_committed == 'true' ||
    steps.version.outputs.already_released == 'true'
```

On the restart, `changeset version` found nothing to do
(`No unreleased changesets found, exiting`), so `version_committed` was `false`
and publish was skipped. **npm is the source of truth, not git** — yet nothing
in the job consulted npm to notice that the committed `0.10.2` had never been
published. The version was stranded.

The pipeline template **does** have a self-heal (`check-release-needed.mjs`),
but its design only probes npm when `has_changesets` is **false**. The #166
restart had a changeset file present in the checkout (`has_changesets=true`)
even though the bump was already consumed on `origin/main`, so the template's
self-heal path was never entered. This is a genuine gap in the template,
reported upstream (§5).

**Fix:** `check-release-needed.mjs` now **always** probes npm and emits a new
`current_unpublished` output, and the publish step gates on it as well:

```yaml
# after
if: steps.version.outputs.version_committed == 'true' ||
    steps.version.outputs.already_released == 'true' ||
    steps.check_release.outputs.current_unpublished == 'true'
```

So whenever the committed `package.json` version is missing from npm — no matter
how it got into that state — the next push runs a catch-up publish. Regression
test: [`js/tests/check-release-needed.test.mjs`](../../../js/tests/check-release-needed.test.mjs)
includes the exact restart shape (changeset present locally + version not on
npm → `current_unpublished=true`).

### 4.6 Post-publish verification — `wait-for-npm.mjs`

As a final belt-and-braces guard against *any* future "tagged but not on npm"
divergence, a new `Verify npm availability` step runs after the GitHub release
is created (in both the `release` and `instant-release` jobs). It polls
`npm view <pkg>@<version>` and **fails the job** if the just-published version
never becomes installable — turning the exact #166 symptom into a hard CI
failure. Pure polling logic is unit-tested in
[`js/tests/wait-for-npm.test.mjs`](../../../js/tests/wait-for-npm.test.mjs).

### 4.7 OIDC precondition assertion — `setup-npm.mjs`

`setup-npm.mjs` was brought in line with the template's robust multi-strategy
npm upgrade (npm ≥ 11.5.1 is required for OIDC trusted publishing) and now
**asserts** the resulting npm version, exiting non-zero if the runner still has
an npm too old to mint OIDC tokens — so an environment that *cannot* publish via
OIDC fails at setup instead of much later with a confusing `E404`.

### 4.8 Release-notes body cap — `create-github-release.mjs`

GitHub rejects release bodies over its size limit. `create-github-release.mjs`
now caps the notes to a UTF-8 byte budget (appending a pointer to the tagged
`CHANGELOG.md` when truncated) and treats an `already_exists` response from the
releases API as idempotent success, so a re-run never errors on an existing tag.

## 5. Template comparison & upstream reports (R3, R7)

Compared against all four pipeline templates
(`js`/`rust`/`python`/`csharp`-ai-driven-development-pipeline-template). Findings:

- **The repo's scripts are stale copies that drifted behind the template.** The
  js template's `scripts/publish-to-npm.mjs`
  ([archived copy](templates/template-publish-to-npm.mjs)) **already** contains
  the multi-layer failure detection (output-pattern scan + exit-code check +
  `npm view` verification), introduced for exactly this class of bug
  (referenced as `link-assistant/agent PR #116 — prevent false positives in
  CI/CD`). This PR brings the repo's copy back in line with that best practice.
  → **No false-positive bug to report for `publish-to-npm.mjs`** (template is
  already correct).
- The js template's `scripts/create-github-release.mjs` is also already
  hardened (it checks the `gh api` result code). The repo's copy was stale.
- **Trusted-publishing rename pitfall (cause #1) is repo-specific, not a
  template bug.** The templates keep a single `release.yml` and publish from it,
  so they never hit the "one workflow file" OIDC constraint. Splitting the
  workflow is what broke this repo.
- **Latent shared issue: `version-and-commit.mjs` `git push` is not exit-code
  checked in the template either.** Because command-stream `$` doesn't throw, a
  failed push would still set `version_committed=true`. This is reported
  upstream to the js template with a reproducible example and fix:
  see [`upstream-issue.md`](upstream-issue.md).
- **Latent shared issue: the template's self-heal misses the "changeset present
  locally but already consumed on remote" restart.** The template's
  `check-release-needed.mjs` only probes npm when `has_changesets` is false, so a
  committed-but-unpublished version with a stale local changeset (exactly the
  #166 restart, cause #3) is never caught and the publish is silently skipped.
  This PR's fix — always probe npm and emit `current_unpublished` — is reported
  upstream with the reproducible restart shape: see
  [`upstream-issue.md`](upstream-issue.md).

## 6. Solution plans per requirement & what was implemented

### Cause #2 (false positive) — fully fixed in this PR

`js/scripts/publish-to-npm.mjs` now treats `changeset:publish` as a captured
command and only reports success when **all three layers** agree:

1. the combined stdout/stderr contains no known failure pattern
   (`packages failed to publish`, `npm error 404/401/403`, `error occurred
   while publishing`, `exited with code 1`, …);
2. the captured exit code is `0`;
3. `npm view <pkg>@<version>` confirms the version is actually on the registry.

On failure it writes `published=false`, prints a diagnostic hint pointing at the
trusted-publishing root cause, and exits non-zero — so the release job goes red
instead of creating a bogus release. `create-github-release.mjs` and
`version-and-commit.mjs` got matching `result.code` checks.

### Cause #3 (restart that didn't deploy) — fully fixed in this PR

`check-release-needed.mjs` now always probes npm and emits `current_unpublished`;
the publish step in both release jobs gates on it, so a committed-but-unpublished
version self-heals on the next push regardless of changeset state. A new
`Verify npm availability` step (`wait-for-npm.mjs`) then asserts the version is
actually installable, and `setup-npm.mjs` asserts npm ≥ 11.5.1 up front so an
OIDC-incapable runner fails at setup. See §4.5–§4.8.

### Cause #1 (E404 / trusted publishing) — owner action required

Pick one (the package owner must do this on npmjs.com — it cannot be done from
the repo):

- **Recommended:** open the `command-stream` package settings on npmjs.com →
  **Trusted Publishing** → update the registered GitHub Actions workflow from
  `release.yml` to **`.github/workflows/js.yml`** (repo
  `link-foundation/command-stream`). This keeps the intentional js/rust split.
- **Alternative:** rename `.github/workflows/js.yml` back to `release.yml` so it
  matches the existing npm registration. (Rust publishes to crates.io, not npm,
  so only the JS workflow needs to be npm's trusted publisher — npm allows only
  one.)
- **Fallback if trusted publishing is undesirable:** add an `NPM_TOKEN` repo
  secret and `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step.

Once cause #1 is addressed, the next merge to `main` will publish to npm; if it
ever fails again, the cause-#2 fix guarantees the job fails instead of faking a
release.

### Cleanup of the bogus releases/tags (optional, owner action)

`js-v0.9.6`, `js-v0.10.0`, `js-v0.10.1` and their tags do not correspond to npm
releases. The owner may delete them (and the matching `0.9.6/0.10.0/0.10.1`
version-bump commits) or simply let the next real release supersede them.

## 7. Existing components / libraries surveyed

- **`@changesets/cli`** — `changeset publish` is the publish driver. It exits
  non-zero on failure (verified in the log), but does so via the npm CLI whose
  output must be inspected; it does not itself guard against a non-throwing
  shell wrapper.
- **npm trusted publishing (OIDC)** — requires npm ≥ 11.5.1 (the workflow's
  `setup-npm.mjs` upgrades to 11.16) and a single bound workflow file per
  package. This binding is the crux of cause #1.
- **`command-stream`** (this package) — non-throwing `$` by design; the correct
  pattern is `.run({ capture: true })` + `result.code`. Already used elsewhere
  in the same script; now used consistently.
- **`execa` / `zx`** — alternatives that throw on non-zero exit; not adopted to
  avoid dog-fooding regressions, but they illustrate the assumption the old code
  was (incorrectly) relying on.

## 8. Files in this folder

- `README.md` — this analysis.
- `ci-logs/run-27213712924-full.log.gz` — full workflow log for the run that created the false-positive `js-v0.10.1` (gzipped, 15k lines).
- `ci-logs/run-27213712924-false-positive-smoking-gun.txt` — de-colored excerpt of the publish + release steps (the smoking gun: `changeset publish` E404 → exit 1 → "✅ Published" → GitHub release).
- `ci-logs/run-27224046292-full.log.gz` — full workflow log for the restart that "failed to do any deploy" (gzipped, 15k lines).
- `ci-logs/run-27224046292-failed-deploy-excerpt.txt` — excerpt showing `No unreleased changesets found, exiting` + `No changes to commit` (cause #3).
- `ci-logs/run-27224046292-release-excerpt.txt` — the `Release JavaScript package` job step list for the restart, proving no `Publish to npm` step ran.
- `ci-logs/npm-vs-github-releases.txt` — snapshot proving npm stops at `0.9.5` while GitHub has `0.9.6/0.10.0/0.10.1` and the repo is at `0.10.2`.
- `templates/template-publish-to-npm.mjs` — the js template's already-correct publish script (best-practice reference).
- `templates/template-create-github-release.mjs`, `templates/template-version-and-commit.mjs`, `templates/template-setup-npm.mjs` — template scripts compared against the repo's copies.
- `upstream-issue.md` — the reproducible report filed against the js template for the latent `git push` false positive.
