// ProcessRunner stream and kill methods - streaming and process termination
// Part of the modular ProcessRunner architecture

import { trace } from './$.trace.mjs';
import { createResult } from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

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
 * Kill a child process with escalating signals
 * @param {object} child - Child process object
 */
function killChildProcess(child) {
  if (!child || !child.pid) {
    return;
  }

  const runtime = isBun ? 'Bun' : 'Node';
  trace(
    'ProcessRunner',
    () =>
      `Killing ${runtime} process | ${JSON.stringify({ pid: child.pid }, null, 2)}`
  );

  const killOperations = [];
  killOperations.push(...sendSignalToProcess(child.pid, 'SIGTERM', runtime));
  killOperations.push(...sendSignalToProcess(child.pid, 'SIGKILL', runtime));

  trace(
    'ProcessRunner',
    () => `${runtime} kill operations attempted: ${killOperations.join(', ')}`
  );

  if (isBun) {
    try {
      child.kill();
      trace(
        'ProcessRunner',
        () => `Called child.kill() for Bun process ${child.pid}`
      );
    } catch (err) {
      trace(
        'ProcessRunner',
        () => `Error calling child.kill(): ${err.message}`
      );
    }
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
 * @param {string} signal - Signal name
 * @returns {number} Exit code
 */
function getSignalExitCode(signal) {
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

  if (runner._cancelResolve) {
    trace('ProcessRunner', () => 'Resolving cancel promise');
    runner._cancelResolve();
  }

  abortController(runner._abortController);
  cleanupVirtualGenerator(runner._virtualGenerator, signal);

  if (runner.child && !runner.finished) {
    trace('ProcessRunner', () => `Killing child process ${runner.child.pid}`);
    try {
      killChildProcess(runner.child);
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

    const onEnd = () => {
      ended = true;
      if (resolve) {
        resolve();
        resolve = _reject = null;
      }
    };

    this.on('data', onData);
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
      this.off('end', onEnd);
      if (!this.finished) {
        killed = true;
        buffer = [];
        this._streamBreaking = true;
        this.kill();
      }
    }
  };

  ProcessRunner.prototype.kill = function (signal = 'SIGTERM') {
    trace(
      'ProcessRunner',
      () => `kill | signal=${signal} finished=${this.finished}`
    );
    if (this.finished) {
      return;
    }
    killRunner(this, signal);
  };
}
