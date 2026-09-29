// zx-compatible core: the `$` tagged template and its companions (issue #26).
//
// `$` is a proxy over a per-async-context options store: reading or writing
// `$.verbose`, `$.cwd`, `$.shell`, ... hits the active `within()` scope (or the
// global `defaults`). Calling `$` with a template literal spawns the command
// and returns a ProcessPromise; calling it with an options object returns a
// preset `$`.

import { AsyncLocalStorage, createHook } from 'node:async_hooks';
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Fail } from './error.mjs';
import { log } from './log.mjs';
import { ProcessOutput, setGlobalDelimiter } from './process-output.mjs';
import { CWD, ProcessPromise, SHOT, SYNC } from './process-promise.mjs';
import { ps, which } from './vendor-core.mjs';
import {
  isString,
  parseBool,
  quote,
  quotePowerShell,
  toCamelCase,
} from './util.mjs';

export { bus } from './internals.mjs';
export { default as path } from 'node:path';
export * as os from 'node:os';
export { Fail } from './error.mjs';
export { log } from './log.mjs';
export { chalk, which, ps } from './vendor-core.mjs';
export { quote, quotePowerShell } from './util.mjs';
export { ProcessOutput } from './process-output.mjs';
export { ProcessPromise } from './process-promise.mjs';

const SIGTERM = 'SIGTERM';
const ENV_PREFIX = 'ZX_';
const ENV_OPTS = new Set([
  'cwd',
  'preferLocal',
  'detached',
  'verbose',
  'quiet',
  'timeout',
  'timeoutSignal',
  'killSignal',
  'prefix',
  'postfix',
  'shell',
]);

/**
 * Apply `ZX_*` environment variables (camel-cased) onto an options object.
 *
 * @param {object} defs Options to mutate and return.
 * @param {string} prefix Environment variable prefix.
 * @param {object} env Environment map.
 * @param {Set<string>} allowed Option names that may be set this way.
 * @returns {object} `defs`.
 */
export function resolveDefaults(
  defs = defaults,
  prefix = ENV_PREFIX,
  env = process.env,
  allowed = ENV_OPTS
) {
  for (const [key, value] of Object.entries(env)) {
    if (!value || !key.startsWith(prefix)) {
      continue;
    }
    const name = toCamelCase(key.slice(prefix.length));
    if (allowed.has(name)) {
      defs[name] = parseBool(value);
    }
  }
  return defs;
}

export const defaults = resolveDefaults({
  [CWD]: process.cwd(),
  [SYNC]: false,
  verbose: false,
  env: process.env,
  sync: false,
  shell: true,
  stdio: 'pipe',
  nothrow: false,
  quiet: false,
  detached: false,
  preferLocal: false,
  spawn: cp.spawn,
  spawnSync: cp.spawnSync,
  log,
  kill,
  killSignal: SIGTERM,
  timeoutSignal: SIGTERM,
});

const storage = new AsyncLocalStorage();

const getStore = () => storage.getStore() || defaults;

/**
 * Run `callback` with a private copy of the current `$` options, so changes
 * made inside (for example `$.cwd = ...` or `cd()`) do not leak outside.
 *
 * @param {Function} callback Code to run.
 * @returns {*} The callback result.
 */
export function within(callback) {
  return storage.run({ ...getStore() }, callback);
}

const OWN_DIR_URL = new URL('.', import.meta.url).href;
const OWN_DIR = path.dirname(fileURLToPath(import.meta.url));
const INTERNAL_FRAME =
  /\((node|native)[:)]|^\s*at (node|native):|\[native code\]|^\s*at unknown$/;

// Location of the user code that invoked `$`: the first stack frame that
// belongs neither to this package nor to the runtime itself.
function callerLocation() {
  const frames = (new Error('zx error').stack || '').split('\n').slice(1);
  const frame = frames.find(
    (line) =>
      !line.includes(OWN_DIR_URL) &&
      !line.includes(OWN_DIR) &&
      !INTERNAL_FRAME.test(line)
  );
  return frame ? frame.trim().replace(/^at\s+/, '') : Fail.getCallerLocation();
}

const snapshotOf = (opts, from, pieces, args) => ({
  ...opts,
  ac: opts.ac || new AbortController(),
  ee: new EventEmitter(),
  from,
  pieces,
  args,
  cmd: '',
});

// `$.sync` yields a synchronous flavour; every other property is read from
// and written to the active options store.
function withSyncFlavour(fn, makeSync) {
  return new Proxy(fn, {
    get(target, key) {
      if (key === 'sync') {
        return makeSync();
      }
      return Reflect.get(key in Function.prototype ? target : getStore(), key);
    },
    set(target, key, value) {
      const dest = key in Function.prototype ? target : getStore();
      return Reflect.set(dest, key === 'sync' ? SYNC : key, value);
    },
  });
}

function preset($shell, opts, overrides) {
  return withSyncFlavour(
    function (...args) {
      return within(() =>
        Object.assign($shell, opts, overrides).apply(this, args)
      );
    },
    () => $shell({ ...overrides, sync: true })
  );
}

export const $ = withSyncFlavour(
  (pieces, ...args) => {
    const opts = getStore();
    if (!Array.isArray(pieces)) {
      return preset($, opts, pieces);
    }
    const from = callerLocation();
    const cb = () => {
      cb[SHOT] = snapshotOf(opts, from, pieces, args);
    };
    const pp = new ProcessPromise(cb);
    if (!pp.isHalted()) {
      pp.run();
    }
    return pp.sync ? pp.output : pp;
  },
  () => $({ sync: true })
);

setGlobalDelimiter(() => $.delimiter);

const setShell = (name, powershell = true) => {
  $.shell = which.sync(name);
  $.prefix = powershell ? '' : 'set -euo pipefail;';
  $.postfix = powershell ? '; exit $LastExitCode' : '';
  $.quote = powershell ? quotePowerShell : quote;
};

export const useBash = () => setShell('bash', false);
export const usePwsh = () => setShell('pwsh');
export const usePowerShell = () => setShell('powershell.exe');

try {
  const { shell, prefix, postfix } = $;
  useBash();
  if (isString(shell)) {
    $.shell = shell;
  }
  if (isString(prefix)) {
    $.prefix = prefix;
  }
  if (isString(postfix)) {
    $.postfix = postfix;
  }
} catch (_err) {
  // No bash on this machine: the caller must pick a shell explicitly.
}

let cwdSyncHook;

const syncCwd = () => {
  if ($[CWD] !== process.cwd()) {
    process.chdir($[CWD]);
  }
};

/**
 * Keep `process.cwd()` in sync with `$[CWD]` across async contexts.
 *
 * @param {boolean} flag Enable (default) or disable the hook.
 */
export function syncProcessCwd(flag = true) {
  cwdSyncHook =
    cwdSyncHook ||
    createHook({
      init: syncCwd,
      before: syncCwd,
      promiseResolve: syncCwd,
      after: syncCwd,
      destroy: syncCwd,
    });
  if (flag) {
    cwdSyncHook.enable();
  } else {
    cwdSyncHook.disable();
  }
}

/**
 * Change the working directory of the process and of subsequent commands.
 *
 * @param {string|ProcessOutput} dir Target directory.
 */
export function cd(dir) {
  const target = dir instanceof ProcessOutput ? dir.toString().trim() : dir;
  $.log({ kind: 'cd', dir: target, verbose: !$.quiet && $.verbose });
  process.chdir(target);
  $[CWD] = process.cwd();
}

const taskkill = (pid) =>
  new Promise((resolve) => {
    cp.exec(`taskkill /pid ${pid} /t /f`, (err) => resolve(!err));
  });

const trySignal = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return true;
  } catch (_err) {
    return false;
  }
};

/**
 * Send `signal` to a process and all of its descendants.
 *
 * @param {number|string} pid Process id.
 * @param {string} signal Signal name.
 */
export async function kill(pid, signal = $.killSignal || SIGTERM) {
  const validType = typeof pid === 'number' || typeof pid === 'string';
  if (!validType || !/^\d+$/.test(pid)) {
    throw new Fail(`Invalid pid: ${pid}`);
  }
  $.log({ kind: 'kill', pid, signal, verbose: !$.quiet && $.verbose });
  if (process.platform === 'win32' && (await taskkill(pid))) {
    return;
  }
  for (const child of await ps.tree({ pid, recursive: true })) {
    trySignal(+child.pid, signal);
  }
  if (!trySignal(-pid, signal)) {
    trySignal(+pid, signal);
  }
}
