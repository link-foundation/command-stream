// Fire-and-forget spawning (issue #232).
//
// `$({ detached: true })`, `runner.spawnDetached()` and `spawnDetached()` start
// a command that outlives the caller and hand back its pid:
//
// * stdio is ignored, so nothing ties the child to the caller's pipes or TTY;
// * the child leads a new session on Unix (`detached: true` calls setsid), so
//   a CTRL+C or a signal aimed at the caller's process group misses it; on
//   Windows it gets a process group and console of its own;
// * the child is `unref()`'d and the runner keeps no listener on it, so the
//   caller's event loop may exit while the child keeps running.
//
// The command runs through the shell (or as an exact argv for `exec` specs)
// with the usual `cwd`, `env`, `preferLocal` and `loginShell` options. Virtual
// commands are not used, since they run inside the caller.
import cp from 'child_process';
import { trace } from './$.trace.mjs';
import {
  buildCommandArgv,
  isShellArgvSpec,
  resolveSpawnCwd,
} from './$.shell.mjs';
import { createResult } from './$.result.mjs';
import { effectiveCwd, effectiveEnv } from './$.process-context.mjs';

function detachedSpawnArguments(runner) {
  if (runner.spec.mode === 'pipeline') {
    throw new Error('A detached command cannot be a programmatic pipeline');
  }
  const env = effectiveEnv(runner) ?? runner.options.env;
  const argv = buildCommandArgv(runner.spec, env, runner.options);
  return [
    argv[0],
    argv.slice(1),
    {
      cwd: resolveSpawnCwd(effectiveCwd(runner)),
      env,
      shell: isShellArgvSpec(runner.spec),
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    },
  ];
}

// The runner is done once the child has started: its result carries the pid,
// and it releases the runner's own resources without touching the child.
function finishDetached(runner, pid) {
  runner._pid = pid;
  runner.result = { ...createResult({ code: 0 }), pid, detached: true };
  runner.finished = true;
  runner._cleanup();
  trace('ProcessRunner', () => `Spawned detached child | pid=${pid}`);
  return runner.result;
}

function spawnChild(runner) {
  const [file, args, options] = detachedSpawnArguments(runner);
  trace(
    'ProcessRunner',
    () => `spawnDetached | ${JSON.stringify({ file, args, cwd: options.cwd })}`
  );
  const child = cp.spawn(file, args, options);
  child.unref();
  return child;
}

/**
 * Start the runner's command detached, resolving with the runner's result
 * (`{ code: 0, pid, detached: true, ... }`) once the process has spawned.
 * @param {object} runner - ProcessRunner instance
 * @returns {Promise<object>}
 */
export function startDetached(runner) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(runner);
    const onError = (error) => {
      child.off('spawn', onSpawn);
      runner.finished = true;
      runner._cleanup();
      reject(error);
    };
    const onSpawn = () => {
      child.off('error', onError);
      resolve(finishDetached(runner, child.pid));
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

/**
 * Synchronous variant for `.sync()`: the pid is known as soon as spawn
 * returns, and a missing pid means the process could not be started.
 * @param {object} runner - ProcessRunner instance
 * @returns {object} Result
 */
export function startDetachedSync(runner) {
  const child = spawnChild(runner);
  if (child.pid === undefined) {
    // The asynchronous 'error' event carries the reason; keep it from being
    // reported as unhandled once this call has already thrown.
    child.once('error', () => {});
    runner.finished = true;
    runner._cleanup();
    throw new Error(
      `Failed to start detached command ${JSON.stringify(child.spawnfile)}`
    );
  }
  return finishDetached(runner, child.pid);
}

export function attachDetachMethods(ProcessRunner) {
  /**
   * Start the command detached from the caller and resolve with `{ pid }`
   * without waiting for it to finish (issue #232).
   * @returns {Promise<{pid: number}>}
   */
  ProcessRunner.prototype.spawnDetached = async function () {
    if (this.started || this.promise) {
      throw new Error('spawnDetached() needs a command that has not started');
    }
    this.options = { ...this.options, detached: true };
    const { pid } = await this._startAsync();
    return { pid };
  };
}
