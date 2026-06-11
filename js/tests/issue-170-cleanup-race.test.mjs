// Regression tests for issue #170:
// "Check CI/CD for all false positives and errors and fix it all"
//
// The CI failure (run 27310950658, Windows/Bun) was the test
// "should provide better error objects than bash" reporting exit code 143
// with stderr "Process killed with SIGTERM" instead of the real exit code 5.
//
// Root causes:
//  1. monitorParentStreams() leaked a 'close' listener on process.stdout /
//     process.stderr on every ProcessRunner construction, because
//     resetGlobalState() cleared the `parentStreamsMonitored` flag without
//     removing the previously attached listeners. They accumulated until
//     Node/Bun emitted a MaxListenersExceeded warning.
//  2. cleanupActiveRunners() (run by resetGlobalState() between tests)
//     force-killed a command that was still running and being awaited,
//     replacing its real exit code with a synthetic SIGTERM (143) result.
//
// These tests reproduce both problems and verify the fixes.
import { test, expect, describe } from 'bun:test';
import './test-helper.mjs'; // installs beforeEach/afterEach resetGlobalState
import { $, resetGlobalState } from '../src/$.mjs';

describe('issue #170 - CI false positives', () => {
  test('resetGlobalState() during an awaited command preserves the real exit code', async () => {
    // Fire a global reset while the command below is still running. This mirrors
    // the Windows/Bun timing where a test-isolation reset raced an in-flight,
    // still-awaited command. The reaper must skip awaited runners so the real
    // exit code wins instead of a synthetic SIGTERM (143).
    const timer = setTimeout(() => resetGlobalState(), 50);

    let observedCode;
    try {
      const result =
        await $`sh -c "echo stdout-marker; echo stderr-marker >&2; sleep 0.3; exit 5"`;
      observedCode = result.code;
    } catch (error) {
      observedCode = error.code;
    } finally {
      clearTimeout(timer);
    }

    expect(observedCode).toBe(5);
  });

  test('errexit error object keeps the real code when reset races the command', async () => {
    const timer = setTimeout(() => resetGlobalState(), 50);

    let error;
    try {
      await $({
        mirror: false,
      })`sh -c "echo out; echo err >&2; sleep 0.3; exit 7"`.then((r) => {
        // shouldn't normally reach here when the command exits non-zero with
        // errexit; but if it does, surface the code for the assertion below.
        error = { code: r.code };
      });
    } catch (e) {
      error = e;
    } finally {
      clearTimeout(timer);
    }

    // The result must reflect the real exit code (7), never a synthetic 143.
    expect(error?.code).toBe(7);
  });

  test('parent stream monitoring does not leak listeners across resets', async () => {
    const before =
      process.stdout.listenerCount('close') +
      process.stderr.listenerCount('close');

    // Each $ construction calls monitorParentStreams(); each resetGlobalState()
    // (run by the afterEach helper and explicitly here) must remove the
    // previously installed listeners rather than letting them accumulate.
    for (let i = 0; i < 25; i++) {
      await $`true`;
      resetGlobalState();
    }

    const after =
      process.stdout.listenerCount('close') +
      process.stderr.listenerCount('close');

    // Without the fix this grew by one per iteration (eventually triggering a
    // MaxListenersExceeded warning). With the fix it stays bounded.
    expect(after - before).toBeLessThanOrEqual(2);
  });
});
