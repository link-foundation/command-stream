import { test, expect } from 'bun:test';
import './helper.mjs';

// Two tests are needed to tell whether the shared hook is active for this file:
// the counter can only grow between them if the hook runs for this file's tests.
let runsBeforeSecondTest = null;

test('b: records how often the shared hook has run', () => {
  runsBeforeSecondTest = globalThis.__hookRuns;
  expect(typeof runsBeforeSecondTest).toBe('number');
});

test('b: only the file that imported the helper first gets the hook', () => {
  const active = globalThis.__hookRuns > runsBeforeSecondTest;
  globalThis.__filesWithHook =
    (globalThis.__filesWithHook ?? 0) + (active ? 1 : 0);
  console.log('[b] shared beforeEach active for this file:', active);
  expect(globalThis.__filesWithHook).toBeLessThanOrEqual(1);
});
