// The `timeout` option (issue #227): milliseconds after which the command is
// stopped the same way an aborted `signal` stops it, i.e. with `killSignal`.
// `0` (the default) means no timeout, like Node's `child_process` options.
import { trace } from './$.trace.mjs';

/**
 * Validate the `timeout` option.
 * @param {unknown} timeout - Option value
 * @returns {number} Milliseconds, or 0 for no timeout
 */
export function normalizeTimeout(timeout) {
  if (timeout === undefined || timeout === null) {
    return 0;
  }
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError(
      `The "timeout" option must be a non-negative finite number of milliseconds, received ${String(timeout)}`
    );
  }
  return timeout;
}

/**
 * Start the timeout timer once per runner.
 * @param {object} runner - ProcessRunner instance
 * @param {() => void} stop - Stops the command (kill + internal abort)
 */
export function setupCommandTimeout(runner, stop) {
  const ms = normalizeTimeout(runner.options.timeout);
  if (!ms || runner._timeoutTimer || runner._timedOut || runner.finished) {
    return;
  }
  runner._timeoutTimer = setTimeout(() => {
    runner._timeoutTimer = null;
    if (runner.finished) {
      return;
    }
    trace('ProcessRunner', () => `Timeout of ${ms} ms reached, stopping`);
    runner._timedOut = true;
    stop();
  }, ms);
  // The child keeps the event loop alive while it runs; the timer must not
  // keep it alive on its own.
  runner._timeoutTimer.unref?.();
}

/**
 * Stop the timer when the command finishes.
 * @param {object} runner - ProcessRunner instance
 */
export function clearCommandTimeout(runner) {
  if (runner._timeoutTimer) {
    clearTimeout(runner._timeoutTimer);
    runner._timeoutTimer = null;
  }
}
