# Case Study: Issue #156 — Default Error Handling Behavior (set -e vs command-stream defaults)

## Summary

**Issue:** [#156 — Investigate user's experience](https://github.com/link-foundation/command-stream/issues/156)
**Related PR:** [link-assistant/calculator#79](https://github.com/link-assistant/calculator/pull/79)
**Date:** 2026-02-26
**Status:** Resolved via documentation and case study

### Problem Statement

A user reported unexpected behavior when using `command-stream` in CI/CD scripts (specifically `scripts/version-and-commit.mjs` in the `link-assistant/calculator` repository). The script used a `try/catch` pattern to detect a non-zero exit code from `git diff --cached --quiet`, but the `catch` block was **never reached** — causing silent failures in an auto-release pipeline.

**Key questions raised by issue #156:**

1. Does `command-stream` stop executing on the first command failure by default (like `bash -e`)?
2. Can this behavior be configured?
3. How does it compare to standard shell behavior?

### Root Cause

`command-stream`'s `$` operator has `errexit: false` by default (equivalent to `bash` without `set -e`). This means:

- Non-zero exit codes **do not** throw exceptions by default.
- Code written with the assumption that `await $`command`` throws on failure will silently continue past errors.
- The `try/catch` anti-pattern fails silently: the `catch` is never reached, and the `try` completes "successfully" even when the command failed.

---

## Timeline / Sequence of Events

```
calculator auto-release pipeline
  │
  ├─ [2026-02-25] version-and-commit.mjs runs on GitHub Actions CI
  │     │
  │     ├─ Cargo.toml updated to version 0.2.0         ← WORKS
  │     ├─ 37 changelog fragments collected             ← WORKS
  │     ├─ $ `git add ...` stages files                 ← WORKS
  │     │
  │     ├─ try {
  │     │     await `git diff --cached --quiet`.run({ capture: true });
  │     │     // INTENDED: only reach here if exit code 0 (no staged changes)
  │     │     console.log('No changes to commit');      ← ALWAYS RUNS ← BUG
  │     │     return;
  │     │  } catch {
  │     │     // INTENDED: reach here when exit code 1 (staged changes exist)
  │     │     // ACTUAL: NEVER REACHED because errexit=false
  │     │  }
  │     │
  │     └─ Pipeline exits "successfully" without committing version bump
  │
  └─ [Repeated] Every CI run failed silently — no commits, no releases
```

### Evidence from CI Logs (calculator issue #78)

```
Updated ./Cargo.toml to version 0.2.0     ← file IS written to disk
Collected 7 changelog fragment(s)          ← fragments ARE processed
No changes to commit                       ← BUG: always executes
```

The script erroneously detected "no staged changes" every time, because `command-stream`'s default `errexit: false` prevented `git diff --cached --quiet` from throwing when exit code was 1 (indicating staged changes).

---

## Technical Analysis

### Bash Default Behavior

In a standard bash script:

```bash
# Default bash (no set -e): continues on error
false
echo "This WILL print"  # Executes after failure
echo "Exit of 'false': $?"  # Prints "1"

# Script exits with 0 (last command succeeded)
```

```bash
# With set -e: exits on first error
set -e
false
echo "This will NOT print"  # Never reached
```

```bash
# With set -o pipefail: pipeline failures propagate
set -e
set -o pipefail
false | true  # Normally exits 0, but with pipefail exits 1
```

### command-stream Default Behavior

```javascript
import { $ } from 'command-stream';

// Default (errexit: false) — like bash without set -e
const result = await $`false`;
console.log('Continued after failure'); // ALWAYS prints
console.log('Exit code:', result.code); // Prints "1"
// Does NOT throw — result.code carries the failure

// With errexit enabled — like bash with set -e
import { shell } from 'command-stream';
shell.errexit(true);
try {
  await $`false`;
} catch (err) {
  console.log('Caught:', err.code); // Prints "1"
}
```

### Behavior Comparison Table

| Scenario                   | bash default             | bash with `set -e` | command-stream default | command-stream with `shell.errexit(true)` |
| -------------------------- | ------------------------ | ------------------ | ---------------------- | ----------------------------------------- |
| `false` exits with code 1  | Continues                | **Aborts**         | Continues              | **Throws**                                |
| Next line after `false`    | Executes                 | Does NOT execute   | Executes               | Does NOT execute (caught by catch)        |
| `try/catch` around `false` | N/A                      | N/A                | catch NOT reached      | catch IS reached                          |
| Script final exit code     | 0 (if last cmd succeeds) | 1                  | 0 (no throw)           | Depends on catch                          |
| Result object available    | N/A                      | N/A                | ✅ `result.code`       | ✅ `error.code`                           |

### The Anti-Pattern: try/catch for Exit Code Detection

The broken pattern in `calculator/scripts/version-and-commit.mjs`:

```javascript
// ❌ WRONG: Relies on exception being thrown, but errexit=false by default
try {
  await $`git diff --cached --quiet`;
  console.log('No changes to commit'); // Always runs with errexit=false
  return;
} catch {
  // NEVER reached when errexit=false
  // Intended to only run when exit code is 1 (staged changes exist)
}
```

The correct pattern:

```javascript
// ✅ CORRECT: Explicitly check exit code
const result = await $`git diff --cached --quiet`;
if (result.code === 0) {
  console.log('No changes to commit');
  return;
}
// Proceed with commit (exit code 1 = staged changes present)
```

### Why command-stream Defaults to errexit: false

The design choice to default `errexit: false` is intentional and follows the convention of most scripting libraries:

1. **Composability:** Many commands intentionally return non-zero codes as signals (e.g., `grep` returns 1 when no match, `git diff --quiet` returns 1 when changes exist).
2. **Explicit error handling:** Users are expected to check `result.code` when exit code semantics matter.
3. **Interoperability:** Matches the default behavior of `child_process` in Node.js, which also does not throw on non-zero exit codes by default.
4. **Progressive strictness:** Users who need `set -e` semantics can opt in via `shell.errexit(true)` for specific script sections.

---

## Configuration API

`command-stream` provides full control over error handling behavior:

```javascript
import { $, shell, set, unset } from 'command-stream';

// Method 1: shell object API (recommended)
shell.errexit(true); // Enable — throws on non-zero exit codes
shell.errexit(false); // Disable — only check result.code

// Method 2: bash-compatible set/unset API
set('e'); // Same as shell.errexit(true)
unset('e'); // Same as shell.errexit(false)

// Method 3: Full option names
set('errexit');

// Combined settings
shell.errexit(true); // Like set -e
shell.pipefail(true); // Like set -o pipefail
shell.nounset(true); // Like set -u

// Check current settings
const settings = shell.settings();
// { errexit: true, pipefail: true, nounset: false, verbose: false, xtrace: false }
```

### Recommended Patterns

**Pattern 1: Strict mode (abort on any failure)**

```javascript
import { $, shell } from 'command-stream';

shell.errexit(true); // All failures throw

await $`git add .`;
await $`git commit -m "Release v1.0.0"`;
await $`git push origin main`;
```

**Pattern 2: Mixed strict/optional**

```javascript
import { $, shell } from 'command-stream';

shell.errexit(true); // Strict by default

// Enable optional section
shell.errexit(false);
const result = await $`git diff --cached --quiet`; // May exit with 1
shell.errexit(true);

// Use result.code explicitly
if (result.code !== 0) {
  await $`git commit -m "Automated version bump"`;
}
```

**Pattern 3: Explicit exit code checks (most readable)**

```javascript
import { $ } from 'command-stream';

// Always check codes explicitly — no exceptions needed
const diff = await $`git diff --cached --quiet`;
if (diff.code !== 0) {
  await $`git commit -m "Release"`;
  const push = await $`git push origin main`;
  if (push.code !== 0) {
    console.error('Push failed:', push.stderr);
    process.exit(push.code);
  }
}
```

---

## Root Causes

### Root Cause 1: `try/catch` Anti-Pattern with `errexit: false` Default

**Where:** `link-assistant/calculator/scripts/version-and-commit.mjs`
**What:** Code used `try/catch` expecting an exception from a failed command, but `command-stream` defaults to `errexit: false`.
**Impact:** Auto-release pipeline silently skipped version commits for every CI run.
**Fix:** Replace `try/catch` with explicit `result.code` check.
**Status:** Fixed in [link-assistant/calculator#79](https://github.com/link-assistant/calculator/pull/79).

### Root Cause 2: Missing Documentation of Default Behavior

**Where:** `command-stream` documentation
**What:** The default `errexit: false` behavior was not prominently documented as a potential gotcha.
**Impact:** Users coming from bash `set -e` mindset or from `execa` (which throws by default) encounter surprising behavior.
**Fix:** Add this case study; update BEST-PRACTICES.md with the try/catch anti-pattern.
**Status:** Addressed in this case study.

---

## Proposed Solutions

### Solution 1: Document the Default Behavior (Implemented)

Add prominent documentation explaining `errexit: false` default and the correct patterns for exit code handling. This case study serves as that documentation.

**Pros:** No breaking changes, educates users.
**Cons:** Users must read documentation.

### Solution 2: Add Warning for try/catch Pattern (Possible Enhancement)

`command-stream` could optionally log a warning when a command exits with non-zero but `errexit: false` is set. This would be a debug-mode feature.

```javascript
// Hypothetical warning mode
shell.warnOnFailure(true); // Log warning when non-zero exit code ignored
```

**Pros:** Visible signal that something failed.
**Cons:** Breaking change in output, potentially noisy.

### Solution 3: Consider Defaulting to errexit: true (Breaking Change)

Some libraries like `execa` throw on non-zero exit codes by default. A `command-stream` v2 could change the default.

**Pros:** Catches bugs like the calculator issue automatically.
**Cons:** Massive breaking change. Many scripts rely on `errexit: false` behavior. Would require a major version bump.

### Solution 4: Per-Command errexit Option (Possible Enhancement)

Allow `errexit` to be specified per-command rather than globally:

```javascript
// Hypothetical per-command option
const result = await $`git diff --cached --quiet`.run({ errexit: false });
```

**Pros:** Fine-grained control without global state.
**Cons:** API change needed.

---

## Comparison with Similar Libraries

| Library               | Default on non-zero exit     | Configuration                       |
| --------------------- | ---------------------------- | ----------------------------------- |
| `bash` (no flags)     | Continue silently            | `set -e` to throw                   |
| `bash -e`             | Exit immediately             | Default when using `bash -e`        |
| `child_process.spawn` | Continue (emit 'exit')       | No built-in throw                   |
| `child_process.exec`  | Callback with error          | Always errors on non-zero           |
| `execa`               | **Throw**                    | `{ reject: false }` to suppress     |
| `zx`                  | **Throw**                    | `$.verbose`, `nothrow()`, `quiet()` |
| `command-stream`      | **Continue** (errexit=false) | `shell.errexit(true)`               |

---

## Related Issues and PRs

- **[link-assistant/calculator#78](https://github.com/link-assistant/calculator/issues/78)** — Original bug report for auto-release pipeline failure
- **[link-assistant/calculator#79](https://github.com/link-assistant/calculator/pull/79)** — Fix: replace try/catch with explicit code check + case study
- **[command-stream#153](https://github.com/link-foundation/command-stream/issues/153)** — Similar documentation issue: Array.join() pitfall
- **[command-stream#156](https://github.com/link-foundation/command-stream/issues/156)** — This issue

---

## Key Takeaways

1. **`command-stream` defaults to `errexit: false`** — non-zero exit codes do NOT throw by default.
2. **Never use `try/catch` to detect non-zero exit codes** with `errexit: false`. Always use `result.code`.
3. **Enable `shell.errexit(true)`** for scripts that should abort on any failure (like `bash -e`).
4. **Use the mixed pattern** for commands that legitimately return non-zero as a signal (like `grep`, `git diff --quiet`).
5. **`result.code`, `result.stdout`, `result.stderr`** are always available on the result object, regardless of `errexit` setting.
