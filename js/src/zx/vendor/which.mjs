// Dependency-free implementation of the `which` (v4+) API.
//
// Locates an executable in the PATH, the same way a shell would.
//
//   await which('node')                  -> '/usr/bin/node'
//   await which('node', { all: true })   -> ['/usr/bin/node', ...]
//   await which('nope', { nothrow: true }) -> null
//   which.sync('node')                   -> '/usr/bin/node'

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATHEXT = '.EXE;.CMD;.BAT;.COM';

function isWindowsHost() {
  return (
    process.platform === 'win32' ||
    process.env.OSTYPE === 'cygwin' ||
    process.env.OSTYPE === 'msys'
  );
}

/** Read an environment variable case-insensitively (Windows uses `Path`). */
function readEnv(name) {
  if (process.env[name] !== undefined) {
    return process.env[name];
  }
  const upper = name.toUpperCase();
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === upper);
  return key === undefined ? undefined : process.env[key];
}

function notFoundError(cmd) {
  const err = new Error(`not found: ${cmd}`);
  err.code = 'ENOENT';
  return err;
}

function stripQuotes(dir) {
  return /^".*"$/.test(dir) ? dir.slice(1, -1) : dir;
}

/**
 * Compute the list of directories and extensions to probe for `cmd`.
 */
function getPathInfo(cmd, opts) {
  const win = isWindowsHost();
  const delimiter = opts.delimiter || path.delimiter;
  const hasSlash = win ? /[\\/]/.test(cmd) : cmd.includes('/');

  let dirs = [''];
  if (!hasSlash) {
    const envPath = opts.path !== undefined ? opts.path : readEnv('PATH');
    const list = String(envPath || '')
      .split(delimiter)
      .filter((d) => d !== '');
    dirs = win ? [process.cwd(), ...list] : list;
  }

  let exts = [''];
  if (win) {
    const rawExt = opts.pathExt || readEnv('PATHEXT') || DEFAULT_PATHEXT;
    exts = rawExt.split(delimiter).filter((e) => e !== '');
    if (cmd.includes('.') || exts.length === 0) {
      exts.unshift('');
    }
  }
  return { dirs, exts, win };
}

/** Yield every candidate filename for `cmd`, in lookup order. */
function* candidates(cmd, opts) {
  const { dirs, exts } = getPathInfo(cmd, opts);
  for (const rawDir of dirs) {
    const dir = stripQuotes(rawDir);
    const joined = path.join(dir, cmd);
    const base =
      !dir && /^\.[\\/]/.test(cmd) ? cmd.slice(0, 2) + joined : joined;
    for (const ext of exts) {
      yield base + ext;
    }
  }
}

function extensionAllowed(file, opts) {
  const rawExt = opts.pathExt || readEnv('PATHEXT') || DEFAULT_PATHEXT;
  const exts = rawExt
    .split(opts.delimiter || path.delimiter)
    .filter((e) => e !== '')
    .map((e) => e.toLowerCase());
  const lower = file.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

/**
 * On case-insensitive Windows filesystems return the on-disk spelling of
 * the basename (e.g. `node.exe` instead of `node.EXE`).
 */
function exactName(file) {
  try {
    const dir = path.dirname(file);
    const base = path.basename(file).toLowerCase();
    const real = fs.readdirSync(dir).find((n) => n.toLowerCase() === base);
    return real ? path.join(dir, real) : file;
  } catch {
    return file;
  }
}

function checkStat(stat, file, opts) {
  if (!stat || !stat.isFile()) {
    return false;
  }
  if (isWindowsHost()) {
    return extensionAllowed(file, opts);
  }
  return true;
}

function isExecutableSync(file, opts) {
  try {
    if (!checkStat(fs.statSync(file), file, opts)) {
      return false;
    }
    if (!isWindowsHost()) {
      fs.accessSync(file, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(file, opts) {
  try {
    if (!checkStat(await fs.promises.stat(file), file, opts)) {
      return false;
    }
    if (!isWindowsHost()) {
      await fs.promises.access(file, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function finish(cmd, opts, found) {
  const unique = [
    ...new Set(found.map((f) => (isWindowsHost() ? exactName(f) : f))),
  ];
  if (unique.length === 0) {
    if (opts.nothrow) {
      return null;
    }
    throw notFoundError(cmd);
  }
  return opts.all ? unique : unique[0];
}

/**
 * Generator driving the search: yields candidate files and expects to be
 * resumed with `true` when the candidate is an executable.
 */
function* search(cmd, opts) {
  const found = [];
  for (const file of candidates(String(cmd), opts)) {
    if (yield file) {
      found.push(file);
      if (!opts.all) {
        break;
      }
    }
  }
  return finish(cmd, opts, found);
}

/**
 * Asynchronously resolve `cmd` in PATH.
 * @param {string} cmd
 * @param {{path?: string, pathExt?: string, all?: boolean, nothrow?: boolean, delimiter?: string}} [opts]
 * @returns {Promise<string|string[]|null>}
 */
export async function which(cmd, opts = {}) {
  const it = search(cmd, opts);
  let step = it.next();
  while (!step.done) {
    step = it.next(await isExecutable(step.value, opts));
  }
  return step.value;
}

/**
 * Synchronously resolve `cmd` in PATH.
 * @param {string} cmd
 * @param {{path?: string, pathExt?: string, all?: boolean, nothrow?: boolean, delimiter?: string}} [opts]
 * @returns {string|string[]|null}
 */
export function sync(cmd, opts = {}) {
  const it = search(cmd, opts);
  let step = it.next();
  while (!step.done) {
    step = it.next(isExecutableSync(step.value, opts));
  }
  return step.value;
}

which.sync = sync;
which.which = which;

export default which;
