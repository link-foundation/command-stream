// Project-local executable resolution shared by the default, zx, and Bun shells.
import path from 'node:path';
import process from 'node:process';

/** Name of the PATH key in an environment (case-insensitive on Windows). */
export function pathKey(env) {
  if (process.platform !== 'win32') {
    return 'PATH';
  }
  return (
    Object.keys(env)
      .reverse()
      .find((key) => key.toUpperCase() === 'PATH') || 'Path'
  );
}

/** Prepend each directory's node_modules/.bin and the directory itself. */
export function preferLocalBin(env, ...dirs) {
  const key = pathKey(env);
  const value = dirs
    .filter(Boolean)
    .flatMap((dir) => [
      path.resolve(dir, 'node_modules', '.bin'),
      path.resolve(dir),
    ])
    .concat(env[key])
    .filter(Boolean)
    .join(path.delimiter);
  return { ...env, [key]: value };
}

/** Prepare a child environment without mutating the caller's environment. */
export function resolvePreferredEnv(env, cwd, preferLocal) {
  if (!preferLocal) {
    return env;
  }
  const dirs =
    preferLocal === true ? [cwd || process.cwd()] : [preferLocal].flat();
  return preferLocalBin(env ?? process.env, ...dirs);
}
