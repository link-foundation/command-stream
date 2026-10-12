// Public entry of the zx-compatible API: `import { $, cd, fs } from
// 'command-stream/zx'` (issue #26).

import { bus } from './core.mjs';
import { versions } from './goods.mjs';

bus.lock();

export * from './core.mjs';
export * from './goods.mjs';
export {
  minimist,
  dotenv,
  fs,
  YAML,
  MAML,
  glob,
  glob as globby,
} from './vendor.mjs';

export const VERSION = versions.zx || '0.0.0';
export const version = VERSION;

/**
 * @deprecated Use $`cmd`.nothrow() instead.
 * @param {ProcessPromise} promise Running command.
 * @returns {ProcessPromise} The same promise.
 */
export const nothrow = (promise) => promise.nothrow();

/**
 * @deprecated Use $`cmd`.quiet() instead.
 * @param {ProcessPromise} promise Running command.
 * @returns {ProcessPromise} The same promise.
 */
export const quiet = (promise) => promise.quiet();
