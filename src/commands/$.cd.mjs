import path from 'path';
import { trace, VirtualUtils } from '../$.utils.mjs';

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
 * Like a real shell, a successful `cd` updates the `PWD` and `OLDPWD`
 * environment variables and changes the Node.js process directory so that
 * subsequent commands (virtual or real) observe the new location.
 */
export default async function cd({ args, cwd }) {
  const home = process.env.HOME || process.env.USERPROFILE || '/';
  const base = cwd || process.cwd();
  const previousDir = process.cwd();

  let target = args[0];
  let printDir = false;

  if (target === undefined || target === '') {
    // `cd` with no argument goes to $HOME, just like sh.
    target = home;
  } else if (target === '-') {
    // `cd -` switches to the previous directory and prints it (sh behavior).
    const oldpwd = process.env.OLDPWD;
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
  const resolved = path.isAbsolute(target) ? target : path.resolve(base, target);

  trace('VirtualCommand', () => `cd: changing directory | ${JSON.stringify({ target, resolved }, null, 2)}`);

  try {
    process.chdir(resolved);
    const newDir = process.cwd();
    // Keep PWD/OLDPWD in sync with the real shell so `$PWD`-style lookups and
    // child processes observe the change.
    process.env.OLDPWD = previousDir;
    process.env.PWD = newDir;
    trace('VirtualCommand', () => `cd: success | ${JSON.stringify({ newDir }, null, 2)}`);
    // A successful `cd` is silent, except for `cd -` which echoes the new dir.
    return VirtualUtils.success(printDir ? newDir + '\n' : '');
  } catch (error) {
    trace('VirtualCommand', () => `cd: failed | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return { stderr: `cd: ${error.message}\n`, code: 1 };
  }
}
