// ProcessRunner stream and kill methods - streaming and process termination
// Part of the modular ProcessRunner architecture

import os from 'os';
import { trace } from './$.trace.mjs';
import { createResult } from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Default milliseconds a child is given to handle the kill signal before
 * SIGKILL follows. Mirrors the Rust `kill_grace_ms` default.
 */
const DEFAULT_KILL_GRACE = 100;

/**
 * Send a signal to a process and its group
 * @param {number} pid - Process ID
 * @param {string} sig - Signal name (e.g., 'SIGTERM', 'SIGKILL')
 * @param {string} runtime - Runtime identifier for logging
 * @returns {string[]} List of successful operations
 */
function sendSignalToProcess(pid, sig, runtime) {
  const operations = [];
  const prefix = runtime === 'Bun' ? 'Bun ' : '';

  try {
    process.kill(pid, sig);
    trace('ProcessRunner', () => `Sent ${sig} to ${prefix}process ${pid}`);
    operations.push(`${sig} to process`);
  } catch (err) {
    trace(
      'ProcessRunner',
      () => `Error sending ${sig} to ${prefix}process: ${err.message}`
    );
  }

  try {
    process.kill(-pid, sig);
    trace(
      'ProcessRunner',
      () => `Sent ${sig} to ${prefix}process group -${pid}`
    );
    operations.push(`${sig} to group`);
  } catch (err) {
    trace(
      'ProcessRunner',
      () => `${prefix}process group ${sig} failed: ${err.message}`
    );
  }

  return operations;
}

/**
 * Check whether a process still exists, without signalling it.
 * @param {number} pid - Process ID
 * @returns {boolean} True when the process is still alive
 */
function processIsAlive(pid) {
  try {
    // Signal 0 performs the permission and existence checks without delivery.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is anything from the original command still running?
 *
 * The check must cover the same target the signal was delivered to: the direct
 * child *and* its process group. A shell wrapper frequently dies on the first
 * signal while the grandchild doing the real work survives and is reparented to
 * init; looking only at the direct child would report "already gone" and skip
 * the escalation, leaving that grandchild running forever.
 *
 * @param {number} pid - Process ID of the direct child / group leader
 * @returns {boolean} True when the process or any group member is still alive
 */
function processTreeIsAlive(pid) {
  return processIsAlive(pid) || processIsAlive(-pid);
}

/**
 * Schedule the forceful SIGKILL escalation that guarantees termination.
 *
 * The escalation is deliberately deferred: sending SIGKILL in the same tick as
 * the requested signal means a child that handles SIGTERM (to flush output,
 * remove a lock file, stop its own children) is destroyed before its handler
 * can run, so a "graceful" stop was never actually graceful.
 *
 * @param {number} pid - Process ID
 * @param {number} graceMilliseconds - Time to wait before SIGKILL
 * @param {string} runtime - Runtime identifier for logging
 */
function scheduleForcefulEscalation(pid, graceMilliseconds, runtime) {
  if (!(graceMilliseconds > 0)) {
    sendSignalToProcess(pid, 'SIGKILL', runtime);
    return;
  }

  const timer = setTimeout(() => {
    if (!processTreeIsAlive(pid)) {
      trace(
        'ProcessRunner',
        () => `Process ${pid} exited within the grace period; no SIGKILL needed`
      );
      return;
    }
    trace(
      'ProcessRunner',
      () => `Grace period elapsed, escalating to SIGKILL for process ${pid}`
    );
    sendSignalToProcess(pid, 'SIGKILL', runtime);
  }, graceMilliseconds);

  // The escalation must never be the reason the process stays alive: an
  // unref'd timer lets the runtime exit as soon as everything else is done.
  timer.unref?.();
}

/**
 * Kill a child process with escalating signals
 * @param {object} child - Child process object
 * @param {string} [signal] - Signal to send first (default 'SIGTERM')
 * @param {number} [graceMilliseconds] - Time the child is given to handle the
 *   signal before SIGKILL follows (default 100)
 */
function killChildProcess(
  child,
  signal = 'SIGTERM',
  graceMilliseconds = DEFAULT_KILL_GRACE
) {
  if (!child || !child.pid) {
    return;
  }

  const runtime = isBun ? 'Bun' : 'Node';
  const pid = child.pid;
  trace(
    'ProcessRunner',
    () =>
      `Killing ${runtime} process | ${JSON.stringify({ pid, signal, graceMilliseconds }, null, 2)}`
  );

  // Send the requested signal first, then escalate to SIGKILL once the grace
  // period has passed, so termination is still guaranteed for a process that
  // ignores the signal. When the requested signal already is SIGKILL there is
  // nothing to wait for and no second delivery to make.
  const killOperations = sendSignalToProcess(pid, signal, runtime);

  trace(
    'ProcessRunner',
    () => `${runtime} kill operations attempted: ${killOperations.join(', ')}`
  );

  if (signal === 'SIGKILL') {
    if (isBun) {
      try {
        child.kill();
        trace(
          'ProcessRunner',
          () => `Called child.kill() for Bun process ${pid}`
        );
      } catch (err) {
        trace(
          'ProcessRunner',
          () => `Error calling child.kill(): ${err.message}`
        );
      }
    }
  } else {
    scheduleForcefulEscalation(pid, graceMilliseconds, runtime);
  }

  child.removeAllListeners?.();
}

/**
 * Kill pipeline components (source and destination)
 * @param {object} spec - Process runner spec
 * @param {string} signal - Kill signal
 */
function killPipelineComponents(spec, signal) {
  if (spec?.mode !== 'pipeline') {
    return;
  }
  trace('ProcessRunner', () => 'Killing pipeline components');
  if (spec.source && typeof spec.source.kill === 'function') {
    spec.source.kill(signal);
  }
  if (spec.destination && typeof spec.destination.kill === 'function') {
    spec.destination.kill(signal);
  }
}

/**
 * Handle abort controller during kill
 * @param {AbortController} controller - The abort controller
 */
function abortController(controller) {
  if (!controller) {
    trace('ProcessRunner', () => 'No abort controller to abort');
    return;
  }
  trace(
    'ProcessRunner',
    () =>
      `Aborting internal controller | ${JSON.stringify({ wasAborted: controller?.signal?.aborted }, null, 2)}`
  );
  controller.abort();
  trace(
    'ProcessRunner',
    () =>
      `Internal controller aborted | ${JSON.stringify({ nowAborted: controller?.signal?.aborted }, null, 2)}`
  );
}

/**
 * Handle virtual generator cleanup during kill
 * @param {object} generator - The virtual generator
 * @param {string} signal - Kill signal
 */
function cleanupVirtualGenerator(generator, signal) {
  if (!generator) {
    trace(
      'ProcessRunner',
      () =>
        `No virtual generator to cleanup | ${JSON.stringify({ hasVirtualGenerator: false }, null, 2)}`
    );
    return;
  }

  trace(
    'ProcessRunner',
    () =>
      `Virtual generator found for cleanup | ${JSON.stringify(
        {
          hasReturn: typeof generator.return === 'function',
          hasThrow: typeof generator.throw === 'function',
          signal,
        },
        null,
        2
      )}`
  );

  if (generator.return) {
    trace('ProcessRunner', () => 'Closing virtual generator with return()');
    try {
      generator.return();
      trace('ProcessRunner', () => 'Virtual generator closed successfully');
    } catch (err) {
      trace(
        'ProcessRunner',
        () =>
          `Error closing generator | ${JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 200) }, null, 2)}`
      );
    }
  } else {
    trace('ProcessRunner', () => 'Virtual generator has no return() method');
  }
}

/**
 * Get exit code for signal
 *
 * Uses the conventional 128 + signal-number mapping (so SIGTERM → 143,
 * SIGKILL → 137, SIGINT → 130, SIGHUP → 129, …) resolved from the runtime's
 * signal table so any configured signal reports a faithful exit code.
 * @param {string} signal - Signal name
 * @returns {number} Exit code
 */
function getSignalExitCode(signal) {
  const signals = os.constants?.signals || {};
  if (typeof signals[signal] === 'number') {
    return 128 + signals[signal];
  }
  // Fallbacks for runtimes that do not expose the signal table.
  if (signal === 'SIGKILL') {
    return 137;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }
  return 130;
}

/**
 * Kill the runner and create result
 * @param {object} runner - ProcessRunner instance
 * @param {string} signal - Kill signal
 */
function killRunner(runner, signal) {
  runner._cancelled = true;
  runner._cancellationSignal = signal;
  killPipelineComponents(runner.spec, signal);

  if (
    runner._activeNestedRunner &&
    !runner._activeNestedRunner.finished &&
    typeof runner._activeNestedRunner.kill === 'function'
  ) {
    trace('ProcessRunner', () => 'Killing active nested command');
    runner._activeNestedRunner.kill(signal);
  }

  if (runner._cancelResolve) {
    trace('ProcessRunner', () => 'Resolving cancel promise');
    runner._cancelResolve();
  }

  abortController(runner._abortController);
  cleanupVirtualGenerator(runner._virtualGenerator, signal);

  if (runner.child && !runner.finished) {
    trace('ProcessRunner', () => `Killing child process ${runner.child.pid}`);
    try {
      killChildProcess(runner.child, signal, runner.options?.killGrace);
      runner.child = null;
    } catch (err) {
      trace('ProcessRunner', () => `Error killing process: ${err.message}`);
      console.error('Error killing process:', err.message);
    }
  }

  const result = createResult({
    code: getSignalExitCode(signal),
    stdout: '',
    stderr: `Process killed with ${signal}`,
    stdin: '',
  });
  runner.finish(result);
}

/**
 * Attach stream and kill methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies (not used but kept for consistency)
 */
export function attachStreamKillMethods(ProcessRunner) {
  ProcessRunner.prototype[Symbol.asyncIterator] = async function* () {
    yield* this.stream();
  };

  ProcessRunner.prototype.stream = async function* () {
    trace('ProcessRunner', () => `stream ENTER | started=${this.started}`);
    this._isStreaming = true;
    this._awaited = true;
    if (!this.started) {
      this._startAsync();
    }

    let buffer = [];
    let resolve, _reject;
    let ended = false;
    let killed = false;

    const onData = (chunk) => {
      if (!killed) {
        buffer.push(chunk);
        if (resolve) {
          resolve();
          resolve = _reject = null;
        }
      }
    };

    // Yield an explicit { type: 'exit', code } chunk when the process exits so
    // consumers can observe the exit code from within the async iterator (see
    // issue #155). 'exit' is emitted by finish() right after 'end', so the
    // chunk is queued before the iterator drains and terminates.
    const onExit = (code) => {
      if (!killed) {
        buffer.push({ type: 'exit', code });
        if (resolve) {
          resolve();
          resolve = _reject = null;
        }
      }
    };

    const onEnd = () => {
      ended = true;
      if (resolve) {
        resolve();
        resolve = _reject = null;
      }
    };

    this.on('data', onData);
    this.on('exit', onExit);
    this.on('end', onEnd);

    try {
      while (!ended || buffer.length > 0) {
        if (killed) {
          break;
        }
        if (buffer.length > 0) {
          const chunk = buffer.shift();
          this._streamYielding = true;
          yield chunk;
          this._streamYielding = false;
        } else if (!ended) {
          await new Promise((res, rej) => {
            resolve = res;
            _reject = rej;
          });
        }
      }
    } finally {
      this.off('data', onData);
      this.off('exit', onExit);
      this.off('end', onEnd);
      if (!this.finished) {
        killed = true;
        buffer = [];
        this._streamBreaking = true;
        this.kill();
      }
    }
  };

  ProcessRunner.prototype.kill = function (signal) {
    // When no explicit signal is passed (e.g. the iterator auto-killing on
    // break), fall back to the configured `killSignal` option, then SIGTERM.
    const effectiveSignal = signal || this.options?.killSignal || 'SIGTERM';
    trace(
      'ProcessRunner',
      () => `kill | signal=${effectiveSignal} finished=${this.finished}`
    );
    if (this.finished) {
      return;
    }
    killRunner(this, effectiveSignal);
  };
}
