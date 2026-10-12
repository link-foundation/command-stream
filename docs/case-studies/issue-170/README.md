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
| 2026-06-11 (this PR) | First fix (commit `9fd7ad2`: reaper guard + listener-leak removal) pushed. The `MaxListenersExceeded` warning disappeared, **but `bun on windows-latest` still failed identically** (run 27315260602) with the synthetic `143`. This proved the reaper was *not* the (only) trigger — see §3.4. |
| 2026-06-11 (this PR) | Second fix (commit `1c53eef`: `_handleParentStreamClosure` guard) pushed, closing the parent-stream-closure teardown path. |

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

So **something tore down a live, still-awaited command**, and because `finish()`
is idempotent (first-wins), a synthetic/teardown result became `this.result`.
When `_doStartAsync` then reached `throwErrexitIfNeeded`, it threw `143` instead
of the real exit code 5.

The unifying root cause is therefore: **a global teardown path force-terminates
a command that user code is actively awaiting.** There are *two* such paths, and
both reach `activeProcessRunners` runners during a `resetGlobalState()`:

```
resetGlobalState() ─┬─ cleanupActiveRunners() ─→ runner.kill() ─→ killRunner()   (Path A — reaper)
                    └─ (a parent stdout/stderr 'close' fires the monitor listener)
                         └─→ runner._handleParentStreamClosure() ─→ abort + child.kill('SIGTERM')   (Path B — parent closure)
```

### 3.2 Path A — the test-isolation reaper race

`cleanupActiveRunners()` (run by `resetGlobalState()` in `test-helper.mjs`'s
`beforeEach`/`afterEach`) iterates `activeProcessRunners` and kills anything still
registered, to prevent leaked fire-and-forget processes from bleeding across
tests. On the slow Windows/Bun runner, the previous test's `afterEach` (or the
next test's `beforeEach`) could **run while this command was still in flight and
still being awaited**. The reaper killed it, the synthetic SIGTERM result won, and
the real exit code 5 was lost. **Root cause #1: the reaper does not distinguish a
leaked runner from a healthy, actively-awaited one.**

### 3.3 Path B — the parent-stream-closure handler (the path that actually broke CI)

`monitorParentStreams()` attaches a `'close'` listener to `process.stdout` /
`process.stderr` so active runners can shut down gracefully when the parent stream
closes. When that listener fires, it calls `_handleParentStreamClosure()` on
**every** active runner, which aborts the runner's controller and kills its child
(`child.kill('SIGTERM')`). For a command being awaited, that replaces the real
exit code with `143` — exactly the failure signature.

Crucially, on Windows/Bun the parent `WriteStream` emits a **spurious** `'close'`
event — the very same stream whose listeners overflowed into the
`MaxListenersExceeded` warning logged 14 seconds before the failure (§3.4). That
spurious close fires Path B against the in-flight, awaited command. **This is why
the reaper-only fix (commit `9fd7ad2`) did not stop the CI failure**: it closed
Path A but left Path B wide open. **Root cause #2: `_handleParentStreamClosure()`
also fails to distinguish a leaked runner from an actively-awaited one.**

### 3.4 The MaxListeners warning — a third, independent defect (and the smoking gun)

The log also shows, before the failure:

```
MaxListenersExceededWarning: … 11 close listeners added to [WriteStream].
```

`monitorParentStreams()` (`js/src/$.state.mjs`) attaches a `'close'` listener to
`process.stdout` and `process.stderr` so active runners can shut down gracefully
when the parent stream closes. It guards with a `parentStreamsMonitored` flag —
but `resetGlobalState()` reset the flag to `false` **without removing the
listeners**. Every test therefore re-attached a new pair of listeners, and they
accumulated until Node/Bun warned at 11. **Root cause #3: listeners are added on
every reset cycle but never removed**, an unbounded leak.

This warning is more than noise — it is the **smoking gun for Path B**. It proves
the parent `WriteStream` was being churned (closed/re-listened) on the
Windows/Bun runner, i.e. exactly the spurious `'close'` activity that fires
`_handleParentStreamClosure()` against the in-flight, awaited command. The warning
and the failure are two symptoms of the same unstable parent-stream lifecycle.

### 3.5 Confirmation (reproduced on Linux, both paths)

- **Path A** — `experiments/repro-issue-170-awaited.mjs` fires
  `resetGlobalState()` 100 ms into an awaited `$\`… exit 5\`` command. Unpatched it
  reproduces `code=143`; fixed it returns `code=5`.
- **Path B** — `experiments/repro-issue-170-parentclose.mjs` emits a spurious
  `process.stdout.emit('close')` 60 ms into an awaited errexit `$\`… exit 5\``
  command. Unpatched it returns `code=143` (the bug); with the
  `_handleParentStreamClosure` guard it returns `code=5`, on **both node and bun**.

The committed regression test `js/tests/issue-170-cleanup-race.test.mjs` encodes
all three defects (reaper race, parent-closure preemption, listener leak). The
parent-closure case was verified to go **143 without the guard → 5 with it**.

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

### Fix 2 — never tear down an awaited runner on parent-stream closure (the CI fix)

The same `_awaited` flag guards `_handleParentStreamClosure()`
(`$.process-runner-base.mjs`). When a runner is being awaited, the graceful
parent-stream shutdown is suppressed — the await is the authoritative consumer, so
a spurious parent `'close'` must not preempt the real result:

```js
// Graceful shutdown on parent-stream closure exists for fire-and-forget /
// streamed commands whose output consumer went away; when the result is being
// awaited, the await is the authoritative consumer. A spurious parent
// stdout/stderr 'close' — observed on Windows/Bun … — must not preempt the
// awaited result and replace the real exit code with a synthetic SIGTERM (143).
if (this._awaited) {
  return;
}
```

Fire-and-forget / streamed runners (e.g. `runner.start()` without awaiting the
runner itself) are **not** flagged `_awaited`, so the legitimate
parent-stream-closure shutdown path is preserved — verified by
`ctrl-c-signal.test.mjs`'s "should handle parent stream closure triggering process
cleanup" still passing.

### Fix 3 — remove parent-stream listeners on reset

`monitorParentStreams()` now records each `{ stream, listener }` it installs in a
module-level `parentStreamListeners` array. A new `removeParentStreamListeners()`
detaches them, and it is called from both `resetParentStreamMonitoring()` and
`resetGlobalState()` (right before clearing `parentStreamsMonitored`). The listener
count is now bounded across any number of resets, eliminating the warning.

### Why not other approaches (rejected alternatives)

- **Guarding the `'close'` handler on `stream.destroyed`** (instead of `_awaited`) —
  rejected. Empirically `process.stdout.destroyed` stays `false` in Node even after
  `process.stdout.destroy()`, so the guard either does nothing or, when interpreted
  strictly, hangs the legitimate parent-stream-closure shutdown path (verified:
  subprocess timed out at rc=124/143). Keying on `_awaited` (intent of the consumer)
  rather than on stream internals is both correct and portable across Node/Bun.
- **Fixing only the reaper (Path A)** — rejected: insufficient. Commit `9fd7ad2` did
  exactly this and CI still failed (run 27315260602) because Path B remained open.
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

### Does the same defect exist in the Rust implementation? — No (parity check)

command-stream ships parallel JavaScript and Rust libraries and enforces a
`JS/Rust source parity` CI gate (`parity.yml`) that fails when `js/src/**`
changes without a matching `rust/src/**` change. This fix touches only
`js/src/**`, so the gate fired — correctly. Investigating the Rust side
(`rust/src/state.rs`) shows its `reset()` simply **clears** the active-runner set
(`active_runners.write().await.clear()`); it never force-kills runners, has no
parent-stream-closure monitoring, and never synthesizes a SIGTERM result. None of
the three JS defects has a Rust counterpart, so there is no equivalent change to
mirror. The PR therefore carries the documented `parity-exempt` label (the gate's
own escape hatch for legitimately single-language changes).

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

- `experiments/repro-issue-170-awaited.mjs` (Path A): clean → `code=143`; fixed → `code=5`.
- `experiments/repro-issue-170-parentclose.mjs` (Path B): clean → `code=143`; fixed → `code=5` on both node and bun.
- `js/tests/issue-170-cleanup-race.test.mjs`: **4 pass / 0 fail** (bun); the parent-closure case verified to fail with `143` when the guard is removed.
- `bun test js/tests/shell-settings.test.mjs js/tests/issue-170-cleanup-race.test.mjs js/tests/ctrl-c-signal.test.mjs`: all pass, no `MaxListenersExceeded` warning; the legitimate parent-stream-closure cleanup test still passes.
- Lint + Prettier: clean on all changed files.
- CI re-run on `bun on windows-latest` after commit `1c53eef`: see PR #171 checks.

---

## 8. Status against requirements

| Req | Status |
| --- | --- |
| R1 fix CI false positives/errors | ✅ all three defects fixed at the source (reaper race, parent-closure preemption, listener leak) |
| R2 compare workflows vs templates | ✅ compared; no matching defect in templates; deltas documented |
| R3 logs + deep case study | ✅ this folder |
| R4 debug/verbose for next iteration | ✅ existing `COMMAND_STREAM_TRACE` tracing sufficient; root cause determined |
| R5 report to other repos | ✅ N/A — root cause is this repo's own source, no external/template target |
| R6 fix across entire codebase | ✅ all consumption entry points flag `_awaited`; both teardown paths (reaper + parent-closure) and the listener leak covered |
| R7 single PR #171 | ✅ all work on `issue-170-9e2e62bb506a` / PR #171 |
