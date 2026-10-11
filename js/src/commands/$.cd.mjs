import path from 'path';
import os from 'os';
import { realpath, stat } from 'fs/promises';
import { trace, VirtualUtils } from '../$.utils.mjs';
import { withVirtualProcessContext } from '../$.process-context.mjs';

/**
 * Virtual `cd` command.
 *
 * Mirrors POSIX `sh`/bash semantics so that shell scripts translate directly:
 *   - `cd`            -> change to $HOME (or $USERPROFILE on Windows)
 *   - `cd ~`/`cd ~/x` -> tilde expands to $HOME
 *   - `cd -`          -> change to $OLDPWD and print the new directory (like sh)
 *   - `cd <dir>`      -> change to <dir> (relative paths resolve against the
 *                        current working directory, or the `cwd` option)
 *
 * Like a real shell, a successful `cd` updates the invocation's logical cwd,
 * `PWD`, and `OLDPWD`. The Node.js process context is never mutated.
 */
export default async function cd({ args, cwd, env }) {
  const invocationEnv = env ?? process.env;
  const home =
    invocationEnv.HOME ||
    invocationEnv.USERPROFILE ||
    path.parse(process.execPath).root;
  const base = await resolveBaseDirectory(cwd, invocationEnv);
  const previousDir = base;

  let target = args[0];
  let printDir = false;

  if (target === undefined || target === '') {
    // `cd` with no argument goes to $HOME, just like sh.
    target = home;
  } else if (target === '-') {
    // `cd -` switches to the previous directory and prints it (sh behavior).
    const oldpwd = invocationEnv.OLDPWD;
    if (!oldpwd) {
      trace('VirtualCommand', () => 'cd: OLDPWD not set');
      return { stdout: '', stderr: 'cd: OLDPWD not set\n', code: 1 };
    }
    target = oldpwd;
    printDir = true;
  } else if (target === '~') {
    target = home;
  } else if (target.startsWith('~/')) {
    target = path.join(home, target.slice(2));
  }

  // Resolve relative targets against the effective base directory so that the
  // `cwd` option and chained `cd` commands behave consistently.
  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(base, target);

  trace(
    'VirtualCommand',
    () =>
      `cd: changing directory | ${JSON.stringify({ target, resolved }, null, 2)}`
  );

  try {
    const newDir = await realpath(resolved);
    const metadata = await stat(newDir);
    if (!metadata.isDirectory()) {
      const error = new Error(`ENOTDIR: not a directory, chdir '${resolved}'`);
      error.code = 'ENOTDIR';
      throw error;
    }
    trace(
      'VirtualCommand',
      () => `cd: success | ${JSON.stringify({ newDir }, null, 2)}`
    );
    // A successful `cd` is silent, except for `cd -` which echoes the new dir.
    return withVirtualProcessContext(
      VirtualUtils.success(printDir ? `${newDir}\n` : ''),
      { cwd: newDir, oldpwd: previousDir }
    );
  } catch (error) {
    trace(
      'VirtualCommand',
      () => `cd: failed | ${JSON.stringify({ error: error.message }, null, 2)}`
    );
    return { stderr: `cd: ${error.message}\n`, code: 1 };
  }
}

async function resolveBaseDirectory(cwd, env) {
  const candidates = [];
  if (cwd) {
    candidates.push(cwd);
  } else {
    try {
      candidates.push(process.cwd());
    } catch (error) {
      trace('VirtualCommand', () => `cd: current cwd unavailable: ${error}`);
    }
  }
  candidates.push(
    env.PWD,
    env.HOME,
    env.USERPROFILE,
    os.tmpdir(),
    path.parse(process.execPath).root
  );

  for (const candidate of new Set(candidates)) {
    if (!candidate) {
      continue;
    }
    try {
      const canonical = await realpath(candidate);
      if ((await stat(canonical)).isDirectory()) {
        return canonical;
      }
    } catch {
      // Try the next invocation-local fallback.
    }
  }

  return path.parse(process.execPath).root;
}
