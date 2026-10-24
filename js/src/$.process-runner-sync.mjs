// Native synchronous execution shared by shell runners and literal builders.
import cp from 'node:child_process';
import { trace } from './$.trace.mjs';
import { normalizeBunExitSignal } from './$.process-runner-signal.mjs';
import { resolveSpawnCwd } from './$.shell.mjs';
import { safeWrite } from './$.stream-utils.mjs';
import {
  createCommandError,
  createExecutionErrorResult,
  createResult,
  determineFinalExitCode,
  getStdinString,
  getSyncStdinInput,
} from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Execute sync process using Bun
 * @param {Array} argv - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} Result object
 */
function executeSyncBun(argv, options) {
  const { cwd, env, stdin, timeout, killSignal } = options;
  let proc;
  try {
    proc = Bun.spawnSync(argv, {
      cwd,
      env,
      stdin:
        getSyncStdinInput(stdin) ??
        (stdin === 'inherit' ? 'inherit' : 'ignore'),
      stdout: options.stdout ?? 'pipe',
      stderr: options.stderr ?? 'pipe',
      timeout,
      killSignal,
    });
  } catch (error) {
    return createExecutionErrorResult(error);
  }

  const signal = normalizeBunExitSignal(proc.exitCode, proc.signalCode);
  const result = createResult({
    code: determineFinalExitCode(proc.exitCode, signal),
    signal,
    stdout: proc.stdout?.toString('utf8') || '',
    stderr: proc.stderr?.toString('utf8') || '',
    stdin: getStdinString(stdin),
  });
  result.timedOut = Boolean(proc.exitedDueToTimeout);
  result.child = proc;
  return result;
}

/**
 * Execute sync process using Node
 * @param {Array} argv - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} Result object
 */
function executeSyncNode(argv, options) {
  const { cwd, env, stdin, shell, timeout, killSignal } = options;
  const proc = cp.spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    shell,
    input: getSyncStdinInput(stdin),
    encoding: 'utf8',
    stdio: [
      stdin === 'inherit' || stdin === 'ignore' ? stdin : 'pipe',
      options.stdout ?? 'pipe',
      options.stderr ?? 'pipe',
    ],
    timeout,
    killSignal,
  });
  // A `timeout` kill sets `error` (ETIMEDOUT) next to the kill signal; report
  // it as a signal exit like the async path does, not as a spawn failure.
  const timedOut = proc.error?.code === 'ETIMEDOUT';

  if (proc.error && !timedOut) {
    const result = createExecutionErrorResult(proc.error);
    result.child = proc;
    return result;
  }

  const signal = isBun
    ? normalizeBunExitSignal(proc.status, proc.signal)
    : (proc.signal ?? null);
  const result = createResult({
    code: determineFinalExitCode(proc.status, signal),
    signal,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    stdin: getStdinString(stdin),
  });
  result.timedOut = timedOut;
  result.child = proc;
  return result;
}

/**
 * Execute sync process with appropriate runtime
 * @param {Array} argv - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} Result object
 */
export function executeSyncProcess(argv, options) {
  // Guard against a deleted/inaccessible working directory (issue #44).
  options = { ...options, cwd: resolveSpawnCwd(options.cwd) };
  trace(
    'ProcessRunner',
    () =>
      `sync stdio | ${JSON.stringify({
        stdin:
          getSyncStdinInput(options.stdin) === undefined
            ? options.stdin
            : 'buffer',
        stdout: options.stdout ?? 'pipe',
        stderr: options.stderr ?? 'pipe',
      })}`,
    { options }
  );
  return isBun && !options.shell
    ? executeSyncBun(argv, options)
    : executeSyncNode(argv, options);
}

/**
 * Handle sync result processing
 * @param {object} runner - ProcessRunner instance
 * @param {object} result - Result object
 * @param {object} globalShellSettings - Shell settings
 * @returns {object} Result
 */
export function processSyncResult(runner, result, globalShellSettings) {
  // The sync spawn has already exited, but reports the pid it ran under.
  runner._pid = result.child?.pid ?? runner._pid;

  if (runner.options.mirror) {
    if (result.stdout) {
      safeWrite(process.stdout, result.stdout);
    }
    if (result.stderr) {
      safeWrite(process.stderr, result.stderr);
    }
  }

  runner.outChunks = runner.options.capture
    ? result.stdout
      ? [Buffer.from(result.stdout)]
      : []
    : null;
  runner.errChunks = runner.options.capture
    ? result.stderr
      ? [Buffer.from(result.stderr)]
      : []
    : null;

  if (result.stdout) {
    runner._emitProcessedData('stdout', Buffer.from(result.stdout));
  }
  if (result.stderr) {
    runner._emitProcessedData('stderr', Buffer.from(result.stderr));
  }

  if (!runner.options.capture) {
    result.stdout = undefined;
    result.stderr = undefined;
    result.stdin = undefined;
    result.text = () => Promise.resolve('');
  }

  runner.finish(result);

  if (globalShellSettings.errexit && result.code !== 0) {
    throw createCommandError(`Command failed with exit code ${result.code}`, {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      result,
    });
  }

  return result;
}
