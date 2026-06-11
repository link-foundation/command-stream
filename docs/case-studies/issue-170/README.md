# Case Study — Issue #170: CI/CD false positive (synthetic SIGTERM masking real exit code)

> "Check CI/CD for all false positives and errors and fix it all"
> Issue: https://github.com/link-foundation/command-stream/issues/170
> Failing run: https://github.com/link-foundation/command-stream/actions/runs/27310950658

This folder is the self-contained record for issue #170. It contains the raw CI
log, the relevant template workflows used for comparison, and this analysis.

```
docs/case-studies/issue-170/
├── README.md                         ← this analysis
├── ci-logs/
│   └── run-27310950658-failed.log    ← full raw log of the failing run
└── template-workflows/js/            ← the JS template workflows compared against
    ├── example-app.yml
    ├── links.yml
    └── release.yml
```

---

## 1. Timeline / sequence of events

| Time (UTC) | Event |
| --- | --- |
| 2026-06-10 22:39:41 | PR #105 (`issue-44-796ff0a8`, "Validate spawn cwd on disk…") merged to `main`, SHA `fe8aae7`. Push triggers workflow run **27310950658**. |
| 22:40:58 | `Test JavaScript (bun on windows-latest)` job starts; `bun install` completes. |
| 22:41:00.122 | **`MaxListenersExceededWarning: … 11 close listeners added to [WriteStream]`** emitted (twice) — the parent-stream listener leak surfaces. |
| 22:41:14.072 | Test `Shell Settings > Shell Replacement Benefits > should provide better error objects than bash` throws **`Command failed with exit code 143`**, `stderr: "Process killed with SIGTERM"`, `result.code: 143`. Expected `code: 5`. |
| 22:41:18.757 | Job summary: **`571 pass / 1 fail`**, `Ran 757 tests across 51 files`. Windows/Bun job concludes **failure**. |
| 22:41:18.859 | `##[error]Process completed with exit code 1`. |
| — | All other matrix legs (bun on ubuntu/macOS, node 20/22/24 on ubuntu) **passed**. Only `bun on windows-latest` failed. |
| 2026-06-10 22:49:36 | Issue #170 filed. |

The failure is a **flaky, timing-dependent false positive**: the same test
passes on every other matrix leg and on local re-runs. It surfaced on a push to
`main` (post-merge), meaning it had slipped through the PR run of #105.

---

## 2. Requirements extracted from the issue

1. **R1 — Fix all CI/CD false positives and errors** (the failing run is the reference).
2. **R2 — Compare every GitHub workflow / CI-CD file** against the four pipeline templates
   (js, rust, python, csharp) and reuse best practices; if the same issue exists in a
   template, report it there too.
3. **R3 — Download all logs/data** related to the issue into `./docs/case-studies/issue-170`
   and produce a deep case study: timeline, requirement list, root cause of each problem,
   and proposed solution plans (checking existing components/libraries). Search online for
   additional facts.
4. **R4 — If data is insufficient for root cause, add debug output / verbose mode** for the
   next iteration.
5. **R5 — If the issue relates to other reportable GitHub repos, file issues there** with
   reproducible examples, workarounds and code-fix suggestions.
6. **R6 — Apply fixes across the entire codebase** (every place exhibiting the issue).
7. **R7 — Do everything in the single PR #171**, continuing until every requirement is met.

---

## 3. Root-cause analysis

### 3.1 The observed failure

The failing test (`js/tests/shell-settings.test.mjs:207`):

```js
test('should provide better error objects than bash', async () => {
  shell.errexit(true);
  try {
    await $`sh -c "echo 'stdout'; echo 'stderr' >&2; exit 5"`;
    expect(true).toBe(false);
  } catch (error) {
    expect(error.code).toBe(5);          // ← got 143 in CI
    expect(error.stdout).toContain('stdout');
    expect(error.stderr).toContain('stderr');
    ...
  }
});
```

The error thrown in CI was **synthetic**, not the real result of the command:

```
error: Command failed with exit code 143
   code: 143,
 stdout: "",
 stderr: "Process killed with SIGTERM",
 result: { code: 143, stdout: "", stderr: "Process killed with SIGTERM", ... }
      at throwErrexitIfNeeded (…/js/src/$.process-runner-execution.mjs:506:21)
      at <anonymous>          (…/js/src/$.process-runner-execution.mjs:1191:7)
```

`code: 143 = 128 + 15` is the exit code for a process terminated by **SIGTERM**.
The string `"Process killed with SIGTERM"` is produced in exactly **one** place
in the codebase — `killRunner()` in `js/src/$.process-runner-stream-kill.mjs`:

```js
const killResult = {
  code: getSignalExitCode(signal),     // SIGTERM → 143
  stdout: '',
  stderr: `Process killed with ${signal}`,
  ...
};
this.finish(killResult);
```

So **something called `runner.kill()` on a live, still-awaited command**, and
because `finish()` is idempotent (first-wins), the synthetic kill result became
`this.result`. When `_doStartAsync` then reached `throwErrexitIfNeeded`, it threw
the synthetic 143 instead of the real exit code 5.

### 3.2 Who called `kill()`? — the test-isolation reaper race

`kill()` here was **not** triggered by the test. It came from the global
test-isolation reset that `test-helper.mjs` runs in `beforeEach`/`afterEach`:

```
resetGlobalState()  →  cleanupActiveRunners()  →  runner.kill()  →  killRunner()
```

`cleanupActiveRunners()` iterates `activeProcessRunners` and kills anything still
registered, to prevent leaked fire-and-forget processes from bleeding across
tests. On the slow Windows/Bun runner, the previous test's `afterEach` (or the
next test's `beforeEach`) **ran while this command was still in flight and still
being awaited**. The reaper killed it, the synthetic SIGTERM result won, and the
real exit code 5 was lost.

This is a genuine race, which is why it only reproduced on the slowest leg
(Windows + Bun) and never locally. **Root cause #1: the reaper does not
distinguish a leaked runner from a healthy, actively-awaited one.**

### 3.3 The MaxListeners warning — a second, independent defect

The log also shows, before the failure:

```
MaxListenersExceededWarning: … 11 close listeners added to [WriteStream].
```

`monitorParentStreams()` (`js/src/$.state.mjs`) attaches a `'close'` listener to
`process.stdout` and `process.stderr` so active runners can shut down gracefully
when the parent stream closes. It guards with a `parentStreamsMonitored` flag —
but `resetGlobalState()` reset the flag to `false` **without removing the
listeners**. Every test therefore re-attached a new pair of listeners, and they
accumulated until Node/Bun warned at 11. **Root cause #2: listeners are added on
every reset cycle but never removed**, an unbounded leak. While the warning
itself did not fail the test, it is noise that masks real leaks and is itself a
CI-quality defect the issue asks us to eliminate.

### 3.4 Confirmation (reproduced on Linux)

`experiments/repro-issue-170-awaited.mjs` fires `resetGlobalState()` 100 ms into
an awaited `$\`… exit 5\`` command. On the unpatched code it reproduces the exact
CI failure (`code=143`, `stderr="Process killed with SIGTERM"`); with the fix it
returns `code=5`. The committed regression test
`js/tests/issue-170-cleanup-race.test.mjs` encodes both defects and goes from
**3 fail (clean) → 3 pass (fixed)**.

---

## 4. The fix (applied to the entire codebase — R6)

Source: commit on branch `issue-170-9e2e62bb506a`.

### Fix 1 — never reap an awaited, in-flight runner

A new `_awaited` flag is initialised to `false` in the `ProcessRunner`
constructor and set to `true` synchronously the moment user code starts consuming
the runner. Every consumption entry point sets it:

- `ProcessRunner.prototype.then` / `.catch` / `.finally` (`$.process-runner-execution.mjs`)
- `stream()` (`$.process-runner-stream-kill.mjs`)

`cleanupActiveRunners()` (`$.state.mjs`) then skips any runner that is being
awaited and has not finished:

```js
// Never force-terminate a command that user code is still awaiting … killing a
// live, awaited command would replace its real exit code with a synthetic
// SIGTERM (143) result and mask the true outcome (issue #170).
if (runner._awaited && !runner.finished) {
  continue;
}
```

Because `await x` calls `x.then(...)` **synchronously** before yielding, the flag
is set before any `beforeEach`/`afterEach` reset can interleave — closing the
race. Leaked fire-and-forget runners (never awaited) are still reaped as before.

### Fix 2 — remove parent-stream listeners on reset

`monitorParentStreams()` now records each `{ stream, listener }` it installs in a
module-level `parentStreamListeners` array. A new `removeParentStreamListeners()`
detaches them, and it is called from both `resetParentStreamMonitoring()` and
`resetGlobalState()` (right before clearing `parentStreamsMonitored`). The listener
count is now bounded across any number of resets.

### Why not other approaches (rejected alternatives)

- **Guarding the `'close'` handler on `stream.destroyed`** — rejected. Empirically
  `process.stdout.destroyed` stays `false` in Node even after `process.stdout.destroy()`,
  so the guard either does nothing or, when interpreted strictly, hangs the legitimate
  parent-stream-closure shutdown path (verified: subprocess timed out at rc=124/143).
- **Raising `setMaxListeners`** — rejected. It hides the leak instead of fixing it.
- **Skipping the test on Windows** — rejected. It hides a real correctness bug
  (a kill racing an await could mask any command's exit code, not just in tests).

---

## 5. Requirement R2 — workflow comparison against the templates

Workflow files in this repo: `.github/workflows/js.yml`, `rust.yml`, `parity.yml`.
Template workflow inventory:

| Template | Workflows |
| --- | --- |
| js-ai-driven-development-pipeline-template | `example-app.yml`, `links.yml`, `release.yml` |
| rust-ai-driven-development-pipeline-template | `release.yml` |
| python-ai-driven-development-pipeline-template | `docs.yml`, `release.yml` |
| csharp-ai-driven-development-pipeline-template | `docs.yml`, `release.yml` |

### Does the failing defect exist in any template? — No.

The synthetic-143 false positive and the listener leak both live in
command-stream's **library source** (`$.state.mjs`, `$.process-runner-*.mjs`).
The templates are project scaffolds; they contain **no** equivalent of
`ProcessRunner`, `cleanupActiveRunners`, or `monitorParentStreams`. There is
therefore **no matching bug to report upstream in the templates** (R2's
conditional "if the same issue is found in a template" does not apply, and R5's
"other reportable repos" likewise has no applicable target — the root cause is
our own code, not a Bun/Node/template defect).

### Best-practice deltas observed (for future hardening)

`js.yml` already matches the template on the highest-value practices:
`concurrency` with `cancel-in-progress`, `fail-fast: false` (this is *why* the
flake surfaced cleanly as a single failed leg instead of cancelling the matrix),
per-job `timeout-minutes`, and a fast-checks-before-test-matrix `needs:` gate.

Differences worth tracking (documented here rather than force-applied, to avoid
destabilising a green pipeline):

| Practice | Template `release.yml` | This repo `js.yml` | Note |
| --- | --- | --- | --- |
| Test runtimes | node + bun + **deno** × 3 OS | bun × 3 OS, node (ubuntu, smoke-load only) | Deno coverage is broader; adopting it is a larger, separate change. |
| Per-test timeout | `bun test --timeout 30000` | `bun test … --timeout 10000` | Both bound hung tests; 10s is stricter. |
| Fresh-merge simulation (PR) | `scripts/simulate-fresh-merge.sh` (see template's issue-23 case study) | not present | Would catch *post-merge* breakage in PR CI — relevant because this flake landed on a push to `main`. Recommended as a follow-up. |

These are recommendations for a follow-up hardening pass; none of them is the
cause of run 27310950658, and changing the matrix shape in this PR would add CI
risk unrelated to the fix.

---

## 6. Requirement R4 — debug/verbose for the next iteration

The library already supports gated tracing via the `COMMAND_STREAM_TRACE`
environment variable (wired into the CI test step as
`COMMAND_STREAM_TRACE: ${{ vars.COMMAND_STREAM_TRACE || 'false' }}`), and the
kill/reset/parent-closure paths emit `trace(...)` lines. Because the root cause
was fully determined from the existing log (the unique `"Process killed with
SIGTERM"` string plus the `throwErrexitIfNeeded` stack frame) and reproduced
deterministically, **no additional debug output was required**. The new
regression test is the durable guard against recurrence.

---

## 7. Verification

- `experiments/repro-issue-170-awaited.mjs`: clean → `code=143` (reproduces); fixed → `code=5`.
- `js/tests/issue-170-cleanup-race.test.mjs`: clean → **3 fail**; fixed → **3 pass** (bun).
- `bun test js/tests/shell-settings.test.mjs js/tests/issue-170-cleanup-race.test.mjs js/tests/ctrl-c-signal.test.mjs`: **31 pass / 0 fail**, no `MaxListenersExceeded` warning.
- Lint + Prettier: clean on all changed files.

---

## 8. Status against requirements

| Req | Status |
| --- | --- |
| R1 fix CI false positives/errors | ✅ both defects fixed at the source |
| R2 compare workflows vs templates | ✅ compared; no matching defect in templates; deltas documented |
| R3 logs + deep case study | ✅ this folder |
| R4 debug/verbose for next iteration | ✅ existing `COMMAND_STREAM_TRACE` tracing sufficient; root cause determined |
| R5 report to other repos | ✅ N/A — root cause is this repo's own source, no external/template target |
| R6 fix across entire codebase | ✅ all consumption entry points + both reset paths covered |
| R7 single PR #171 | ✅ all work on `issue-170-9e2e62bb506a` / PR #171 |
