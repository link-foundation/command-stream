// zx-compatible convenience helpers (issue #26): temp files, argv parsing,
// sleep, fetch with `.pipe`, echo, question, stdin, retry, spinner.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import {
  $,
  Fail,
  os,
  path,
  ProcessOutput,
  ProcessPromise,
  within,
} from './core.mjs';
import {
  getLast,
  identity,
  isStringLiteral,
  parseBool,
  parseDuration,
  randomId,
  toCamelCase,
} from './util.mjs';
import { fs, minimist, nodeFetch } from './vendor.mjs';

export { versions } from './versions.mjs';

const isVerbose = () => !$.quiet && $.verbose;

/**
 * Create (if needed) a directory inside the OS temp dir.
 *
 * @param {string} prefix Directory name.
 * @param {number} mode Permissions.
 * @returns {string} Absolute path.
 */
export function tempdir(prefix = `zx-${randomId()}`, mode) {
  const dirpath = path.join(os.tmpdir(), prefix);
  fs.mkdirSync(dirpath, { recursive: true, mode });
  return dirpath;
}

/**
 * Create a temp file, optionally named and filled with `data`.
 *
 * @param {string} name File name (placed in a fresh temp dir).
 * @param {string|Buffer} data Initial contents.
 * @param {number} mode Permissions.
 * @returns {string} Absolute path.
 */
export function tempfile(name, data, mode) {
  const filepath = name
    ? path.join(tempdir(), name)
    : path.join(os.tmpdir(), `zx-${randomId()}`);
  if (data === undefined) {
    fs.closeSync(fs.openSync(filepath, 'w', mode));
  } else {
    fs.writeFileSync(filepath, data, { mode });
  }
  return filepath;
}

export { tempdir as tmpdir, tempfile as tmpfile };

/**
 * minimist with optional camelCase keys and boolean-string parsing.
 *
 * @param {string[]} args Arguments.
 * @param {object} opts minimist options plus `camelCase`, `parseBoolean`.
 * @param {object} defs Object to fill.
 * @returns {object} Parsed arguments.
 */
export const parseArgv = (
  args = process.argv.slice(2),
  opts = {},
  defs = {}
) => {
  const kTrans = opts.camelCase ? toCamelCase : identity;
  const vTrans = opts.parseBoolean ? parseBool : identity;
  for (const [k, v] of Object.entries(minimist(args, opts))) {
    const raw = k === '--' || k === '_';
    defs[raw ? k : kTrans(k)] = raw ? v : vTrans(v);
  }
  return defs;
};

export const argv = parseArgv();

/**
 * Re-parse `argv` in place.
 *
 * @param {string[]} args Arguments.
 * @param {object} opts Parse options.
 */
export function updateArgv(args, opts) {
  for (const k in argv) {
    delete argv[k];
  }
  parseArgv(args, opts, argv);
}

/**
 * @param {number|string} duration Milliseconds or `'1s'`, `'100ms'`, ...
 * @returns {Promise<void>}
 */
export function sleep(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, parseDuration(duration));
  });
}

const responseToReadable = (response, rs) => {
  const reader = response.body?.getReader();
  if (!reader) {
    rs.push(null);
    return rs;
  }
  rs._read = async () => {
    const result = await reader.read();
    rs.push(result.done ? null : Buffer.from(result.value));
  };
  return rs;
};

/**
 * `fetch` that logs in verbose mode and can `.pipe` the body into a command
 * (template literal) or any writable.
 *
 * @param {string|URL|Request} url Resource.
 * @param {object} init Fetch options.
 * @returns {Promise<Response>} Response promise with a `pipe` method.
 */
export function fetch(url, init) {
  $.log({ kind: 'fetch', url, init, verbose: isVerbose() });
  const p = nodeFetch(url, init);
  return Object.assign(p, {
    pipe(dest, ...args) {
      const rs = new Readable();
      const target = isStringLiteral(dest, ...args)
        ? $({ halt: true, signal: init?.signal })(dest, ...args)
        : dest;
      p.then(
        (r) => responseToReadable(r, rs).pipe(target.run?.()),
        (err) =>
          // A halted command has no process to abort: settle it with the
          // request error instead (upstream's `abort()` throws and hangs).
          target instanceof ProcessPromise && target.isHalted()
            ? target.finalize(ProcessOutput.fromError(err))
            : target.abort?.(err)
      );
      return target;
    },
  });
}

const stringify = (arg) =>
  arg instanceof ProcessOutput ? arg.toString().trimEnd() : `${arg}`;

/**
 * Print to stdout; accepts a template literal or plain arguments.
 *
 * @param {...*} args Pieces or values.
 */
export function echo(...args) {
  const [pieces, ...rest] = args;
  const msg = isStringLiteral(pieces, ...rest)
    ? rest.map((a, i) => pieces[i] + stringify(a)).join('') + getLast(pieces)
    : args.map(stringify).join(' ');
  console.log(msg);
}

/**
 * Ask a question on the terminal.
 *
 * @param {string} query Prompt.
 * @param {object} options `choices` (tab completion), `input`, `output`.
 * @returns {Promise<string>} Answer.
 */
export function question(
  query,
  { choices, input = process.stdin, output = process.stdout } = {}
) {
  const completer = Array.isArray(choices)
    ? (line) => {
        const hits = choices.filter((c) => c.startsWith(line));
        return [hits.length ? hits : choices, line];
      }
    : undefined;
  const rl = createInterface({ input, output, terminal: true, completer });
  return new Promise((resolve) =>
    rl.question(query ?? '', (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

/**
 * Read a whole stream (stdin by default) as a UTF-8 string.
 *
 * @param {Readable} stream Source.
 * @returns {Promise<string>} Contents.
 */
export async function stdin(stream = process.stdin) {
  let buf = '';
  for await (const chunk of stream.setEncoding('utf8')) {
    buf += chunk;
  }
  return buf;
}

function* constantDelay(ms) {
  while (true) {
    yield ms;
  }
}

/**
 * Call `cb` up to `count` times until it resolves.
 *
 * @param {number} count Attempts.
 * @param {number|string|Generator|Function} d Delay (or the callback).
 * @param {Function} cb Callback.
 * @returns {Promise<*>} First successful result.
 */
export async function retry(count, d, cb) {
  if (typeof d === 'function') {
    return retry(count, 0, d);
  }
  if (!cb) {
    throw new Fail('Callback is required for retry');
  }
  const total = count;
  const gen = typeof d === 'object' ? d : constantDelay(parseDuration(d));
  let attempt = 0;
  let lastErr;
  while (count-- > 0) {
    attempt++;
    try {
      return await cb();
    } catch (err) {
      lastErr = err;
      const delay = gen.next().value;
      $.log({
        kind: 'retry',
        total,
        attempt,
        delay,
        exception: err,
        verbose: isVerbose(),
        error: `FAIL Attempt: ${attempt}/${total}, next: ${delay}`,
      });
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

/**
 * Exponential backoff delays for `retry`, capped at `max`.
 *
 * @param {number|string} max Upper bound.
 * @param {number|string} delay Initial delay.
 * @yields {number} Delay in milliseconds.
 */
export function* expBackoff(max = '60s', delay = '100ms') {
  const maxMs = parseDuration(max);
  const randMs = parseDuration(delay);
  let n = 0;
  while (true) {
    yield Math.min(randMs * 2 ** n++, maxMs);
  }
}

const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/**
 * Show a spinner while `callback` runs (disabled in quiet mode and on CI).
 *
 * @param {string|Function} title Title (or the callback).
 * @param {Function} callback Work to do.
 * @returns {Promise<*>} Callback result.
 */
export function spinner(title, callback) {
  if (typeof title === 'function') {
    return spinner('', title);
  }
  if ($.quiet || process.env.CI) {
    return new Promise((resolve) => resolve(callback()));
  }
  let i = 0;
  const stream = $.log.output || process.stderr;
  const spin = () => stream.write(`  ${SPINNER_FRAMES[i++ % 10]} ${title}\r`);
  return within(async () => {
    $.verbose = false;
    const id = setInterval(spin, 100);
    try {
      return await callback();
    } finally {
      clearInterval(id);
      stream.write(`${' '.repeat((process.stdout.columns || 1) - 1)}\r`);
    }
  });
}
