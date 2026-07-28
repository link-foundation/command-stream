# Case study — Issue #164: "CI/CD is broken"

- **Issue:** <https://github.com/link-foundation/command-stream/issues/164>
- **Pull request:** <https://github.com/link-foundation/command-stream/pull/165>
- **Reported:** 2026-06-08
- **Affected runs:**
  - JavaScript checks and release — [run 27164605452](https://github.com/link-foundation/command-stream/actions/runs/27164605452) — ✅ success
  - Rust checks and release — [run 27164605403](https://github.com/link-foundation/command-stream/actions/runs/27164605403) — ❌ **failure**

This folder contains the downloaded CI logs (`ci-logs/`) and this deep-dive
analysis. It is self-contained: every claim below is backed by a line in the
saved logs or by source already in the repository.

---

## 1. Executive summary

The release pipeline broke because the **Rust** release script
(`rust/scripts/version-and-commit.rs`) staged the version bump with `git add`
**before** running `git rebase origin/main`. `git rebase` refuses to run with a
dirty index, so the release aborted with:

```
Local branch is behind remote, rebasing...
Error rebasing onto origin/main: Command failed: error: cannot rebase: Your index contains uncommitted changes.
error: Please commit or stash them.
##[error]Process completed with exit code 1.
```

The rebase was genuinely *needed*: the JavaScript release job, triggered by the
same push, had already bumped the package to `0.9.6` and pushed it to `main`,
so `origin/main` had advanced under the Rust job's feet. The Rust job correctly
detected "local branch is behind remote" — but then could not rebase because it
had already dirtied its index. The **JavaScript** script does the same two
operations in the *opposite* (correct) order, which is exactly why the JS run
succeeded while the Rust run failed on the very same commit.

The fix moves the fetch + rebase to run **before any file modification**, while
the working tree is clean — matching the JS script. The identical bug exists in
`link-foundation/rust-ai-driven-development-pipeline-template` and has been
reported upstream.

---

## 2. Timeline / sequence of events

All timestamps UTC, from `ci-logs/rust-run-27164605403-full.log` and
`ci-logs/js-release-job-27164605452.log`.

| Time | Actor | Event |
|------|-------|-------|
| 20:22:00 | GitHub | Merge commit `89d47cf` ("Merge pull request #163") pushed to `main`. This triggers **both** `js.yml` (run …452) and `rust.yml` (run …403). Both check out `89d47cf`. |
| 20:22:03–20:23:1x | both | `lint` / `test` / `build` jobs run and pass in both pipelines. |
| 20:23:31 | JS release | JS `version-and-commit.mjs` bumps `js/package.json` to `0.9.6`, commits `971eab5`, and **pushes to `main`** → `origin/main` is now `971eab5`, ahead of `89d47cf`. (`✅ Version bump committed and pushed to main`) |
| 20:25:16 | Rust release | Rust `version-and-commit.rs` starts; computes `0.9.6` as the next version. |
| 20:25:21.44 | Rust release | Updates `rust/Cargo.toml` and `rust/Cargo.lock` to `0.9.6`, collects 2 changelog fragments, and **stages them with `git add`** (index now dirty). |
| 20:25:21.71 | Rust release | Detects `origin/main` advanced → prints `Local branch is behind remote, rebasing...`. |
| 20:25:21.72 | Rust release | `git rebase origin/main` **fails**: `cannot rebase: Your index contains uncommitted changes`. Script exits 1. ❌ |
| 20:25:21.97 | runner | Post-job warning: `Node.js 20 actions are deprecated … actions/checkout@v4`. |

The race is the trigger; the ordering bug is the root cause. Without the
concurrent JS push there would have been nothing to rebase onto and the bug
would have stayed dormant — which is why this had not surfaced before.

---

## 3. Requirements extracted from the issue

| # | Requirement | Status |
|---|-------------|--------|
| R1 | Check for **all** false positives and errors in the two CI runs/jobs. | ✅ done — see §4 |
| R2 | Compare **all** GitHub workflow / CI files against the 4 pipeline templates; reuse best practices. | ✅ done — see §5 |
| R3 | If the same issue exists in a template, report an issue there too. | ✅ done — Rust template issue filed (§6) |
| R4 | Download all logs/data to `./docs/case-studies/issue-164/` and do a deep case study (timeline, requirements, root causes, solution plans, existing-component survey, online facts). | ✅ this document + `logs/` |
| R5 | If there is not enough data for root cause, add debug output / verbose mode. | ✅ enough data existed; additionally added a regression test + a CI job so the scripts are now exercised (§7) |
| R6 | If the issue relates to another repo where issues can be filed, file them with reproducible example, workaround, and code-fix suggestion. | ✅ Rust template issue includes all three |
| R7 | Fully apply the fix across the entire codebase (fix every place sharing the issue). | ✅ see §4.4 — only the Rust script shared it |
| R8 | Plan and execute everything in the single PR #165. | ✅ all work on branch `issue-164-55c0bfaf481d` |

---

## 4. Root-cause analysis

### 4.1 Primary failure — rebase with a dirty index (Rust release)

**Symptom (verbatim, `ci-logs/release-rust-crate-step.log`):**

```
Updated rust/Cargo.toml to version 0.9.6
Updated rust/Cargo.lock to version 0.9.6
Collected 2 changelog fragment(s)
Local branch is behind remote, rebasing...
Error rebasing onto origin/main: Command failed: error: cannot rebase: Your index contains uncommitted changes.
error: Please commit or stash them.
##[error]Process completed with exit code 1.
```

**Buggy ordering (original `rust/scripts/version-and-commit.rs`):**

1. Modify `Cargo.toml` / `Cargo.lock`.
2. `git add` the manifest, lockfile, changelog, and changelog fragments → **index now dirty**.
3. `git fetch origin <branch>`; if behind, `git rebase origin/<branch>` → **fails on the dirty index**.
4. `git commit` (never reached).

`git rebase` performs an implicit `require_clean_work_tree` and aborts if the
index has staged-but-uncommitted changes — this is documented Git behaviour,
not a flake (see §8).

**Why the JS pipeline did not fail:** `js/scripts/version-and-commit.mjs` rebases
*first*, then stages:

```js
await $`git rebase origin/main`;   // line 179 — clean tree
...
await $`git add -A`;               // line 215 — stage AFTER rebase
await $`git commit -m "${escapedMessage}"`;
```

### 4.2 The race that exposed it

Both workflows fire on every push to `main` that touches shared paths
(`README.md`, `LICENSE`, the workflow files). The JS release finished first,
bumped to `0.9.6`, and pushed — advancing `origin/main`. The Rust release,
still based on the pre-push commit, then *had* to rebase, and the latent
ordering bug turned a normal concurrent-release rebase into a hard failure.

### 4.3 Secondary finding — Node 20 deprecation warnings (both pipelines)

The runs emitted `Node.js 20 actions are deprecated … actions/checkout@v4`
(6 occurrences in the Rust run). The workflows pinned `actions/checkout@v4`,
`actions/cache@v4`, `actions/setup-node@v4`, and `peter-evans/create-pull-request@v7`.
GitHub forces Node 20 actions to Node 24 starting 2026-06-16 and removes Node 20
on 2026-09-16. These were warnings (not the failure) but are real future
breakage and a documented "best practice" gap vs. the templates.

### 4.4 Codebase-wide audit (R7)

Every place that bumps a version and rebases/pushes was checked:

| Script / file | Rebase before staging? | Verdict |
|---------------|------------------------|---------|
| `rust/scripts/version-and-commit.rs` | ❌ was after → **fixed** | was broken |
| `js/scripts/version-and-commit.mjs` | ✅ rebases first (L179 < L215) | already correct |
| `js/scripts/instant-version-bump.mjs` | only edits files; no git ops | not affected |
| `rust/scripts/*.rs` (publish, release, wait, size, changelog) | no rebase-then-stage pattern | not affected |

Only the Rust script shared the bug. No other occurrence exists in the repo.

---

## 5. Workflow comparison against the 4 templates (R2)

Action versions in use **after** this PR vs. each template
(`actions/checkout`, `actions/setup-node`, `actions/cache`,
`peter-evans/create-pull-request`, `oven-sh/setup-bun`):

| Action | command-stream (this PR) | js tmpl | rust tmpl | python tmpl | csharp tmpl |
|--------|--------------------------|---------|-----------|-------------|-------------|
| checkout | **v6** | v6 | v6 | v6 | v6 |
| setup-node | **v6** | v6 | — | — | — |
| cache | **v5** | — | v5 | — | — |
| create-pull-request | **v8** | v8 | v8 | — | v8 |
| setup-bun | v2 | v2 | — | — | v2 |

All bumps now match the templates exactly.

**`version-and-commit` rebase ordering across templates:**

| Template | Pattern | Shares the bug? |
|----------|---------|-----------------|
| rust | `git add` (L710/719) → `fetch`+`rebase` (L736/744) → `commit` (L768) | ✅ **YES — reported (§6)** |
| js | `git rebase` (L217) → `git add` (L260) → `commit` (L265) | ❌ no (correct order) |
| csharp | `git add` (L374) → `commit` (L392); **no rebase at all** | ❌ no |
| python | release-on-version-change in `release.yml`; no in-CI bump+rebase | ❌ no |

---

## 6. Upstream issue (R3, R6)

The `rust-ai-driven-development-pipeline-template` `scripts/version-and-commit.rs`
contains the identical staging-before-rebase ordering. An issue was filed
upstream with: a reproducible example, a workaround, and a concrete code-fix
suggestion (move the fetch+rebase block ahead of the first `git add`, mirroring
the JS template).

> Upstream issue: <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/67>

---

## 7. Solution plans per requirement & what was implemented

- **R1 / R4 / R7 — fix + audit:** moved the fetch+rebase sync in
  `rust/scripts/version-and-commit.rs` to run **before** any file edit, while
  the tree is clean. Verified no other script shares the pattern.
- **R5 — observability & prevention:**
  - Added a regression unit test
    `rebase_must_run_before_staging_the_version_bump()` that builds a temp git
    repo, reproduces the dirty-index failure for the buggy order, and proves the
    fixed order succeeds.
  - Added a **`scripts` CI job** to `rust.yml` that runs the inline
    `rust-script --test` suites for every `rust/scripts/*.rs` and **gates the
    `release` job** on it. Previously these tests never ran in CI (`cargo test`
    only covers the library crate), so the release scripts were entirely
    untested in CI.
- **R2 — best practices:** bumped all actions to match the templates
  (checkout v6, setup-node v6, cache v5, create-pull-request v8), clearing the
  Node 20 deprecation warnings.
- **R3 / R6 — upstream:** filed the template issue with repro + workaround + fix.

A standalone local reproduction lives at
`experiments/issue-164/reproduce-rebase-bug.sh`
(`./reproduce-rebase-bug.sh buggy` fails with the exact error;
`./reproduce-rebase-bug.sh fixed` succeeds).

---

## 8. Existing components / libraries & online facts surveyed

- **Git's `require_clean_work_tree`** — `git rebase`, `git pull --rebase`, and
  similar commands refuse to run with staged-but-uncommitted changes; this is
  intentional, documented behaviour, not environment-specific. The robust
  pattern is *sync first on a clean tree, then mutate*. The fix follows this.
- **`git pull --rebase --autostash` / `git rebase --autostash`** — Git can
  auto-stash and re-apply local changes around a rebase. We deliberately did
  **not** rely on autostash: the correct fix is to never dirty the tree before
  syncing (cheaper, no stash-conflict surface), and it keeps parity with the
  already-correct JS script.
- **Concurrency controls** — both workflows already set a `concurrency` group
  (`${{ github.workflow }}-${{ github.ref }}`). That serializes runs *within a
  single workflow* but not *across* the JS and Rust workflows, which is why the
  cross-pipeline race is real and the rebase is genuinely required. Handling it
  in-script (rebase onto the advanced `origin/main`) is the right layer.
- **GitHub Actions Node 20 deprecation** — announced 2025-09-19; Node 20 actions
  forced to Node 24 from 2026-06-16, Node 20 removed 2026-09-16. The template
  repos had already upgraded to checkout v6 / setup-node v6 / cache v5; this PR
  brings command-stream in line.
- **`rust-script`** — single-file Rust scripts support inline `#[cfg(test)]`
  modules executed via `rust-script --test <file>`; this is what the new
  `scripts` CI job leverages so the release scripts gain real test coverage.

---

## 9. Files in this folder

```
docs/case-studies/issue-164/
├── README.md                            # this analysis
└── ci-logs/
    ├── rust-run-27164605403-full.log    # full Rust run log, the failure (ANSI-stripped)
    ├── release-rust-crate-step.log      # cleaned excerpt of the failing "Release Rust crate" step
    └── js-release-job-27164605452.log   # the successful JS "Release" job (proves the correct ordering)
```

The logs live under `ci-logs/` rather than `logs/` because the repository's
`.gitignore` ignores any directory literally named `logs`.
