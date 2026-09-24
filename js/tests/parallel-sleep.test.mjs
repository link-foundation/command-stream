import { describe, expect, test } from 'bun:test';
import { isWindows } from './test-helper.mjs'; // Installs per-test state cleanup
import { $, disableVirtualCommands } from '../src/$.mjs';

// Issue #22: starting 2-3 commands that sleep inside must run them at the same
// time and let every one of them finish.
//
// Timing alone is a weak signal on a loaded CI machine, so each test asserts
// three independent things:
//   1. every command completed successfully (and produced its output),
//   2. the execution windows of the commands overlap, which is what "parallel"
//      actually means,
//   3. the wall clock stayed well below the sequential total.

// A sleep long enough that process startup noise cannot hide it, short enough
// to keep the suite fast.
const SLEEP_SECONDS = 0.5;
const SLEEP_MS = SLEEP_SECONDS * 1000;

// Timers are allowed to fire slightly early (timer resolution, rounding in the
// sleep implementation), so the per-command lower bound gets a small slack.
const TIMER_SLACK_MS = 50;

// The wall clock of a parallel run is compared against the sequential total.
// 75% leaves room for startup overhead while still failing loudly if the
// commands were serialized.
const SEQUENTIAL_FRACTION = 0.75;

/**
 * Start a command and record when it started and finished.
 * @param {object} command Thenable command returned by `$`
 * @returns {Promise<{result: object, startedAt: number, finishedAt: number}>}
 */
function timed(command) {
  const startedAt = Date.now();
  return Promise.resolve(command).then((result) => ({
    result,
    startedAt,
    finishedAt: Date.now(),
  }));
}

/**
 * Assert that every pair of runs was in flight at the same moment.
 * @param {Array<{startedAt: number, finishedAt: number}>} runs Completed runs
 */
function expectOverlappingExecution(runs) {
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      // Half-open windows overlap when each one starts before the other ends.
      expect(runs[i].startedAt).toBeLessThan(runs[j].finishedAt);
      expect(runs[j].startedAt).toBeLessThan(runs[i].finishedAt);
    }
  }
}

/**
 * Assert that a run slept at least as long as it was asked to.
 * @param {{startedAt: number, finishedAt: number}} run Completed run
 * @param {number} expectedMs Requested sleep in milliseconds
 */
function expectSlept(run, expectedMs) {
  expect(run.finishedAt - run.startedAt).toBeGreaterThanOrEqual(
    expectedMs - TIMER_SLACK_MS
  );
}

describe('parallel sleep commands', () => {
  test('runs 2 sleeping commands at the same time', async () => {
    const startedAt = Date.now();
    const runs = await Promise.all([
      timed($`sleep ${SLEEP_SECONDS}`),
      timed($`sleep ${SLEEP_SECONDS}`),
    ]);
    const elapsed = Date.now() - startedAt;

    for (const run of runs) {
      expect(run.result.code).toBe(0);
      expectSlept(run, SLEEP_MS);
    }
    expectOverlappingExecution(runs);
    expect(elapsed).toBeLessThan(2 * SLEEP_MS * SEQUENTIAL_FRACTION);
  });

  test('runs 3 sleeping commands at the same time', async () => {
    const startedAt = Date.now();
    const runs = await Promise.all([
      timed($`sleep ${SLEEP_SECONDS}`),
      timed($`sleep ${SLEEP_SECONDS}`),
      timed($`sleep ${SLEEP_SECONDS}`),
    ]);
    const elapsed = Date.now() - startedAt;

    for (const run of runs) {
      expect(run.result.code).toBe(0);
      expectSlept(run, SLEEP_MS);
    }
    expectOverlappingExecution(runs);
    expect(elapsed).toBeLessThan(3 * SLEEP_MS * SEQUENTIAL_FRACTION);
  });

  test('finishes mixed durations in the time of the longest one', async () => {
    const durations = [0.2, 0.5, 0.3];
    const startedAt = Date.now();
    const runs = await Promise.all(
      durations.map((seconds) => timed($`sleep ${seconds}`))
    );
    const elapsed = Date.now() - startedAt;

    runs.forEach((run, index) => {
      expect(run.result.code).toBe(0);
      expectSlept(run, durations[index] * 1000);
    });
    expectOverlappingExecution(runs);

    const sequentialMs = durations.reduce((total, s) => total + s, 0) * 1000;
    expect(elapsed).toBeLessThan(sequentialMs * SEQUENTIAL_FRACTION);
  });

  test.skipIf(isWindows)(
    'runs real sleep processes in parallel when virtual commands are off',
    async () => {
      // Without the built-in sleep the commands become real child processes,
      // so this covers process spawning rather than the virtual command path.
      // test-helper.mjs re-enables virtual commands after the test.
      disableVirtualCommands();

      const startedAt = Date.now();
      const runs = await Promise.all([
        timed($`sleep ${SLEEP_SECONDS}`),
        timed($`sleep ${SLEEP_SECONDS}`),
        timed($`sleep ${SLEEP_SECONDS}`),
      ]);
      const elapsed = Date.now() - startedAt;

      for (const run of runs) {
        expect(run.result.code).toBe(0);
        expectSlept(run, SLEEP_MS);
      }
      expectOverlappingExecution(runs);
      expect(elapsed).toBeLessThan(3 * SLEEP_MS * SEQUENTIAL_FRACTION);
    }
  );

  test.skipIf(isWindows)(
    'keeps the output of commands that sleep between writes',
    async () => {
      const startedAt = Date.now();
      const runs = await Promise.all(
        [1, 2, 3].map((id) =>
          timed(
            $`sh -c ${`echo "start ${id}"; sleep ${SLEEP_SECONDS}; echo "end ${id}"`}`
          )
        )
      );
      const elapsed = Date.now() - startedAt;

      runs.forEach((run, index) => {
        const id = index + 1;
        expect(run.result.code).toBe(0);
        expect(run.result.stdout.trim().split('\n')).toEqual([
          `start ${id}`,
          `end ${id}`,
        ]);
        expectSlept(run, SLEEP_MS);
      });
      expectOverlappingExecution(runs);
      expect(elapsed).toBeLessThan(3 * SLEEP_MS * SEQUENTIAL_FRACTION);
    }
  );

  test.skipIf(isWindows)(
    'gives each parallel command its own environment',
    async () => {
      const runs = await Promise.all(
        [1, 2, 3].map((id) =>
          timed(
            $`sh -c ${`VALUE="value ${id}"; sleep ${SLEEP_SECONDS}; echo "$VALUE"`}`
          )
        )
      );

      runs.forEach((run, index) => {
        expect(run.result.code).toBe(0);
        expect(run.result.stdout.trim()).toBe(`value ${index + 1}`);
      });
      expectOverlappingExecution(runs);
    }
  );
});
