// ProcessRunner exit handling - detecting process exit and draining stdio pumps
// Part of the modular ProcessRunner architecture.
//
// These helpers exist to solve issue #155: after a child process exits, its
// stdout/stderr pipes normally reach EOF almost immediately. But if the child
// spawned grandchildren that inherited those pipes (e.g.
// `sh -c 'long-task & echo done'`), the pipes can stay open long after the
// command itself has exited, leaving the output pumps — and therefore finish()
// and any stream() iterator — hanging indefinitely.

import { trace } from './$.trace.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

// Once the process has exited, we wait this long for the pumps to drain
// naturally and then force the lingering readables closed.
export const EXIT_PUMP_GRACE_MS = 100;

/**
 * Wait for the output/stdin pumps to settle after the process has exited,
 * without hanging forever if grandchildren keep the stdio pipes open. If the
 * pumps do not drain naturally within the grace period, the abort controller
 * is triggered so the pumps stop reading and resolve.
 * @param {object} runner - ProcessRunner instance
 * @param {Promise[]} pumps - Pending pump promises
 * @param {AbortController} pumpAbort - Controller that aborts the output pumps
 * @returns {Promise<void>}
 */
export async function drainPumpsAfterExit(runner, pumps, pumpAbort) {
  const allSettled = Promise.allSettled(pumps);

  const graceMs =
    typeof runner.options.exitPumpGrace === 'number'
      ? runner.options.exitPumpGrace
      : EXIT_PUMP_GRACE_MS;

  if (graceMs > 0) {
    let timer;
    const grace = new Promise((resolve) => {
      timer = setTimeout(resolve, graceMs);
      timer.unref?.();
    });

    const winner = await Promise.race([
      allSettled.then(() => 'pumps'),
      grace.then(() => 'grace'),
    ]);
    clearTimeout(timer);

    if (winner === 'pumps') {
      return;
    }

    trace(
      'ProcessRunner',
      () =>
        `Pumps still pending ${graceMs}ms after exit; aborting stdio reads (pipes likely held open by a grandchild)`
    );
  }

  pumpAbort?.abort();
  await allSettled;
}

/**
 * Create promise for child exit.
 *
 * Resolves with the child's exit code as soon as the process exits — or as
 * soon as the runner is cancelled — without waiting for the stdio pipes to
 * close (a grandchild may keep them open indefinitely, issue #155).
 *
 * @param {object} child - Child process
 * @param {object} [runner] - ProcessRunner instance (for cancellation)
 * @returns {Promise}
 */
export function createExitPromise(child, runner) {
  // Bun's spawn exposes an `exited` promise. Note that even under Bun we may
  // have spawned via Node's child_process (e.g. when an explicit stdin pipe is
  // needed), in which case `child.exited` is undefined and we must fall back to
  // the event-based path below — otherwise `await undefined` resolves
  // immediately with the wrong (undefined) exit code.
  //
  // Even on the Bun path we still race against cancellation: killRunner aborts
  // the runner's internal controller, and we must resolve promptly so the
  // awaiting caller doesn't hang (see the Node note below).
  const signal = runner?._abortController?.signal;

  if (isBun && child.exited && typeof child.exited.then === 'function') {
    if (!signal) {
      return child.exited;
    }
    return new Promise((resolve) => {
      let resolved = false;
      const settle = (code) => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(code);
      };
      child.exited.then(settle, () => settle(null));
      if (signal.aborted) {
        settle(null);
      } else {
        signal.addEventListener('abort', () => settle(null), { once: true });
      }
    });
  }

  return new Promise((resolve) => {
    trace(
      'ProcessRunner',
      () => `Setting up child process event listeners for PID ${child.pid}`
    );

    let resolved = false;
    const settle = (code) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(code);
    };

    // killRunner() calls killChildProcess(), which removes all of the child's
    // listeners (including the 'exit'/'close' handlers below) before the exit
    // event has a chance to fire. Without this, `await exited` would hang
    // forever on a kill/cancel. Resolve as soon as the runner is cancelled so
    // the caller can finalize with the signal-derived exit code.
    if (signal) {
      if (signal.aborted) {
        settle(null);
      } else {
        signal.addEventListener('abort', () => settle(null), { once: true });
      }
    }

    // Resolve as soon as the process itself exits. We deliberately do NOT wait
    // for the 'close' event (which only fires once every stdio stream is also
    // closed) because grandchildren that inherited the pipes can keep them
    // open long after the command has exited, which would otherwise hang the
    // caller indefinitely (issue #155). drainPumpsAfterExit() drains any
    // remaining buffered output before the result is finalized.
    child.on('exit', (code, exitSignal) => {
      trace(
        'ProcessRunner',
        () =>
          `Child process exit event | ${JSON.stringify({
            pid: child.pid,
            code,
            signal: exitSignal,
            killed: child.killed,
            exitCode: child.exitCode,
            signalCode: child.signalCode,
          })}`
      );
      settle(code);
    });

    // 'close' is still handled as a fallback in case 'exit' never fires.
    child.on('close', (code, closeSignal) => {
      trace(
        'ProcessRunner',
        () =>
          `Child process close event | ${JSON.stringify({
            pid: child.pid,
            code,
            signal: closeSignal,
            killed: child.killed,
            exitCode: child.exitCode,
            signalCode: child.signalCode,
          })}`
      );
      settle(code);
    });
  });
}
