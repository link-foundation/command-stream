// Small helpers shared by the zx-compatible layer (issue #26).
//
// Every helper mirrors the observable behavior of the matching google/zx
// utility so scripts written for zx keep working unchanged, but the code is an
// independent implementation that only relies on Node.js built-ins.

import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';

export const noop = () => {};

export const identity = (value) => value;

export const randomId = () => Math.random().toString(36).slice(2);

export const isString = (value) => typeof value === 'string';

export const isStringLiteral = (pieces, ...rest) =>
  pieces?.length > 0 &&
  pieces.raw?.length === pieces.length &&
  rest.length + 1 === pieces.length;

const utf8Decoder = new TextDecoder();

export const bufToString = (value) =>
  isString(value) ? value : utf8Decoder.decode(value);

export const bufArrJoin = (chunks) =>
  chunks.reduce((acc, chunk) => acc + bufToString(chunk), '');

export const getLast = (list) => list[list.length - 1];

export const isPromiseLike = (value) => typeof value?.then === 'function';

/**
 * Case-insensitive lookup of the PATH variable name (`Path` on Windows).
 *
 * @param {object} env Environment map.
 * @returns {string} The key that holds the search path.
 */
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

/**
 * Prepend `<dir>/node_modules/.bin` and `<dir>` for every directory to PATH.
 *
 * @param {object} env Environment map (not mutated).
 * @param {...string} dirs Directories that should win the binary lookup.
 * @returns {object} A new environment map.
 */
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

const SAFE_WORD = /^[\w/.\-+@:=,%]+$/;

const ANSI_C_ESCAPES = {
  '\\': '\\\\',
  "'": "\\'",
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
  '\0': '\\0',
};

/**
 * Quote a value for bash using ANSI-C quoting (`$'...'`) like zx does.
 *
 * @param {string} arg Value to quote.
 * @returns {string} The quoted word.
 */
export function quote(arg) {
  if (arg === '') {
    return `$''`;
  }
  if (SAFE_WORD.test(arg)) {
    return arg;
  }
  const escaped = String(arg).replace(
    /[\\'\f\n\r\t\v\0]/g,
    (ch) => ANSI_C_ESCAPES[ch]
  );
  return `$'${escaped}'`;
}

/**
 * Quote a value for PowerShell (single quotes, doubled inner quotes).
 *
 * @param {string} arg Value to quote.
 * @returns {string} The quoted word.
 */
export function quotePowerShell(arg) {
  if (arg === '') {
    return `''`;
  }
  if (SAFE_WORD.test(arg)) {
    return arg;
  }
  return `'${String(arg).replace(/'/g, "''")}'`;
}

const DURATION_UNITS = { s: 1000, ms: 1, m: 60000 };

/**
 * Convert `100`, `'100'`, `'100ms'`, `'2s'` or `'1m'` to milliseconds.
 *
 * @param {number|string} duration Duration value.
 * @returns {number} Milliseconds.
 */
export function parseDuration(duration) {
  if (typeof duration === 'number') {
    if (Number.isNaN(duration) || duration < 0) {
      throw new Error(`Invalid duration: "${duration}".`);
    }
    return duration;
  }
  const match = /^(\d+)(m?s?)$/.exec(duration);
  if (!match) {
    throw new Error(`Unknown duration: "${duration}".`);
  }
  const [, amount, unit] = match;
  return +amount * (DURATION_UNITS[unit] || 1);
}

export function once(fn) {
  let called = false;
  let result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

/**
 * Proxy an object so that the provided getters win over its own properties.
 *
 * @param {object} origin Target object.
 * @param {...object} fallbacks Objects consulted before the origin.
 * @returns {object} Proxy.
 */
export function proxyOverride(origin, ...fallbacks) {
  return new Proxy(origin, {
    get(target, key) {
      const source = fallbacks.find((fallback) => key in fallback);
      return source?.[key] ?? Reflect.get(target, key);
    },
  });
}

export const toCamelCase = (str) =>
  str
    .toLowerCase()
    .replace(
      /([a-z])[_-]+([a-z])/g,
      (_match, left, right) => `${left}${right.toUpperCase()}`
    );

export const parseBool = (value) =>
  value === 'true' || (value !== 'false' && value);

/**
 * Split a chunk into complete lines, carrying the unterminated tail in memo.
 *
 * @param {string|Buffer} chunk New data.
 * @param {string[]} memo Single-element array holding the pending tail.
 * @param {string|RegExp} delimiter Line delimiter.
 * @returns {string[]} Complete lines.
 */
export function getLines(chunk, memo, delimiter) {
  const lines = `${memo.pop() || ''}${bufToString(chunk)}`.split(delimiter);
  memo.push(lines.pop());
  return lines;
}

export function iteratorToArray(iterator) {
  const result = [];
  for (let step = iterator.next(); !step.done; step = iterator.next()) {
    result.push(step.value);
  }
  return result;
}

const substitute = (arg) =>
  typeof arg?.stdout === 'string' ? arg.stdout.replace(/\n$/, '') : `${arg}`;

/**
 * Interleave template pieces with quoted arguments.
 *
 * Arrays expand to space-separated quoted words and ProcessOutput-like values
 * contribute their stdout without the trailing newline. When any argument is
 * a promise the command resolves asynchronously.
 *
 * @param {Function} quoteFn Quoting function.
 * @param {string[]} pieces Template pieces.
 * @param {Array} args Template arguments.
 * @returns {string|Promise<string>} The command text.
 */
export function buildCmd(quoteFn, pieces, args) {
  if (args.some(isPromiseLike)) {
    return Promise.all(args).then((resolved) =>
      buildCmd(quoteFn, pieces, resolved)
    );
  }
  let cmd = pieces[0];
  args.forEach((arg, i) => {
    const text = Array.isArray(arg)
      ? arg.map((item) => quoteFn(substitute(item))).join(' ')
      : quoteFn(substitute(arg));
    cmd += text + pieces[i + 1];
  });
  return cmd;
}

export const toBuffer = (value) =>
  Buffer.isBuffer(value) ? value : Buffer.from(value);
