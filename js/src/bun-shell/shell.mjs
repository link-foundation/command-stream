// The Bun Shell JavaScript API (`Bun.$`) on top of the portable interpreter,
// ported from Bun's src/js/builtins/shell.ts. Runs unchanged on Node.js,
// Bun and Deno:
//
//   import { $ } from 'command-stream/bun';
//   const name = await $`echo ${'world'} | cat`.text();

import { braces } from './braces.mjs';
import { resolvePreferredEnv } from '../$.local-bin.mjs';
import { ShellFile } from './file.mjs';
import { Interpreter } from './interpreter.mjs';
import { parse } from './parser.mjs';
import { buildShellSource, shellEscape } from './template.mjs';

/** An unpooled copy, so `.buffer` is exactly the output (as in Bun). */
function ownBuffer(buf) {
  const out = Buffer.alloc(buf.length);
  buf.copy(out);
  return out;
}

function lazyBufferToHumanReadableString() {
  return this.toString();
}

export class ShellOutput {
  constructor(stdout, stderr, exitCode) {
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }

  text(encoding) {
    return this.stdout.toString(encoding);
  }

  json() {
    return JSON.parse(this.stdout.toString());
  }

  arrayBuffer() {
    return this.stdout.buffer;
  }

  bytes() {
    return new Uint8Array(this.arrayBuffer());
  }

  blob() {
    return new Blob([this.stdout]);
  }
}

export class ShellError extends Error {
  #output = undefined;

  constructor() {
    super('');
  }

  initialize(output, code) {
    this.message = `Failed with exit code ${code}`;
    this.#output = output;
    this.name = 'ShellError';
    Object.defineProperty(this, 'info', {
      value: { exitCode: code, stderr: output.stderr, stdout: output.stdout },
      writable: true,
      enumerable: false,
      configurable: true,
    });
    this.info.stdout.toJSON = lazyBufferToHumanReadableString;
    this.info.stderr.toJSON = lazyBufferToHumanReadableString;
    this.stdout = output.stdout;
    this.stderr = output.stderr;
    this.exitCode = code;
  }

  text(encoding) {
    return this.#output.text(encoding);
  }

  json() {
    return this.#output.json();
  }

  arrayBuffer() {
    return this.#output.arrayBuffer();
  }

  bytes() {
    return this.#output.bytes();
  }

  blob() {
    return this.#output.blob();
  }
}

/**
 * The parsed script plus its settings (Bun's `ParsedShellScript`). Parsing
 * happens eagerly, so syntax errors throw from the `$` call itself.
 */
class ParsedShellScript {
  constructor(rawStrings, values) {
    const { script, jsobjs, jsstrings } = buildShellSource(rawStrings, values);
    this.ast = parse(script, jsstrings, jsobjs.length);
    this.jsobjs = jsobjs;
    this.cwd = undefined;
    this.env = undefined;
    this.preferLocal = false;
    this.quiet = false;
  }

  setCwd(cwd) {
    if (cwd === undefined) {
      throw new Error('$`...`.cwd(): expected a string argument');
    }
    this.cwd = String(cwd);
  }

  setEnv(env) {
    if (env === null || typeof env !== 'object') {
      throw new TypeError('env must be an object');
    }
    const out = {};
    for (const key of Object.keys(env)) {
      if (env[key] !== undefined) {
        out[key] = String(env[key]);
      }
    }
    this.env = out;
  }
}

export class ShellPromise extends Promise {
  #args = undefined;
  #hasRun = false;
  #throws = true;
  #resolve;
  #reject;

  constructor(args, throws) {
    // Created up front so the stack points at the `$` call site.
    let potentialError = new ShellError();
    let resolve;
    let reject;
    super((res, rej) => {
      resolve = (code, stdout, stderr) => {
        const out = new ShellOutput(stdout, stderr, code);
        if (this.#throws && code !== 0) {
          potentialError.initialize(out, code);
          rej(potentialError);
        } else {
          potentialError = undefined;
          res(out);
        }
      };
      reject = (error) => {
        potentialError = undefined;
        rej(error);
      };
    });
    this.#throws = throws;
    this.#args = args;
    this.#resolve = resolve;
    this.#reject = reject;
  }

  cwd(newCwd) {
    this.#throwIfRunning();
    if (
      newCwd === undefined ||
      newCwd === '.' ||
      newCwd === '' ||
      newCwd === './'
    ) {
      newCwd = process.cwd();
    }
    this.#args.setCwd(newCwd);
    return this;
  }

  env(newEnv) {
    this.#throwIfRunning();
    this.#args.setEnv(newEnv === undefined ? process.env : newEnv);
    return this;
  }

  /** Prefer project-local executables (a command-stream extension). */
  preferLocal(value = true) {
    this.#throwIfRunning();
    this.#args.preferLocal = value;
    return this;
  }

  #run() {
    if (this.#hasRun) {
      return;
    }
    this.#hasRun = true;
    const args = this.#args;
    this.#args = undefined;
    let interp;
    try {
      interp = new Interpreter({
        jsobjs: args.jsobjs,
        env: resolvePreferredEnv(args.env ?? {}, args.cwd, args.preferLocal),
        cwd: args.cwd,
        quiet: args.quiet,
      });
    } catch (e) {
      this.#reject(e);
      return;
    }
    interp.run(args.ast).then(
      ({ exitCode, stdout, stderr }) =>
        this.#resolve(exitCode, ownBuffer(stdout), ownBuffer(stderr)),
      (e) => this.#reject(e)
    );
  }

  #quiet(isQuiet = true) {
    this.#throwIfRunning();
    this.#args.quiet = Boolean(isQuiet);
    return this;
  }

  quiet(isQuiet) {
    return this.#quiet(isQuiet ?? true);
  }

  nothrow() {
    this.#throws = false;
    return this;
  }

  throws(doThrow) {
    this.#throws = Boolean(doThrow);
    return this;
  }

  async text(encoding) {
    const { stdout } = await this.#quiet(true);
    return stdout.toString(encoding);
  }

  async json() {
    const { stdout } = await this.#quiet(true);
    return JSON.parse(stdout.toString());
  }

  async *lines() {
    const { stdout } = await this.#quiet(true);
    yield* stdout
      .toString()
      .split(process.platform === 'win32' ? /\r?\n/ : '\n');
  }

  async arrayBuffer() {
    const { stdout } = await this.#quiet(true);
    return stdout.buffer;
  }

  async bytes() {
    return new Uint8Array(await this.arrayBuffer());
  }

  async blob() {
    const { stdout } = await this.#quiet(true);
    return new Blob([stdout]);
  }

  #throwIfRunning() {
    if (this.#hasRun) {
      throw new Error('Shell is already running');
    }
  }

  run() {
    this.#run();
    return this;
  }

  then(onfulfilled, onrejected) {
    this.#run();
    return super.then(onfulfilled, onrejected);
  }

  static get [Symbol.species]() {
    return Promise;
  }
}

const cwdSymbol = Symbol('cwd');
const envSymbol = Symbol('env');
const preferLocalSymbol = Symbol('preferLocal');
const throwsSymbol = Symbol('throws');
const originalDefaultEnv = process.env;

class ShellPrototype {
  env(newEnv) {
    if (newEnv === undefined || newEnv === originalDefaultEnv) {
      this[envSymbol] = originalDefaultEnv;
    } else if (newEnv) {
      this[envSymbol] = Object.assign({}, newEnv);
    } else {
      throw new TypeError('env must be an object or undefined');
    }
    return this;
  }

  cwd(newCwd) {
    if (newCwd === undefined || typeof newCwd === 'string') {
      if (newCwd === '.' || newCwd === '' || newCwd === './') {
        newCwd = process.cwd();
      }
      this[cwdSymbol] = newCwd;
    } else {
      throw new TypeError('cwd must be a string or undefined');
    }
    return this;
  }

  /** Prefer project-local executables by default (a command-stream extension). */
  preferLocal(value = true) {
    this[preferLocalSymbol] = value;
    return this;
  }

  nothrow() {
    this[throwsSymbol] = false;
    return this;
  }

  throws(doThrow) {
    this[throwsSymbol] = Boolean(doThrow);
    return this;
  }
}

function makeShellFunction(name) {
  const fn = {
    [name](first, ...rest) {
      if (first?.raw === undefined) {
        throw new Error(
          "Please use '$' as a tagged template function: $`cmd arg1 arg2`"
        );
      }
      const parsed = new ParsedShellScript(first.raw, rest);
      const cwd = fn[cwdSymbol];
      const env = fn[envSymbol];
      if (cwd) {
        parsed.setCwd(cwd);
      }
      if (env) {
        parsed.setEnv(env);
      }
      parsed.preferLocal = fn[preferLocalSymbol];
      return new ShellPromise(parsed, fn[throwsSymbol]);
    },
  }[name];
  Object.setPrototypeOf(fn, ShellPrototype.prototype);
  fn[cwdSymbol] = undefined;
  fn[envSymbol] = originalDefaultEnv;
  fn[preferLocalSymbol] = false;
  fn[throwsSymbol] = true;
  return fn;
}

/** `new $.Shell()`: an independent `$` with its own cwd/env/throws. */
export function Shell() {
  if (!new.target) {
    throw new TypeError(
      "Class constructor Shell cannot be invoked without 'new'"
    );
  }
  return makeShellFunction('Shell');
}
Shell.prototype = ShellPrototype.prototype;
Object.setPrototypeOf(Shell, ShellPrototype);

/** Bun.$-compatible tagged template function. */
export const $ = makeShellFunction('BunShell');

Object.defineProperties($, {
  Shell: { value: Shell, enumerable: true },
  ShellPromise: { value: ShellPromise, enumerable: true },
  ShellError: { value: ShellError, enumerable: true },
  escape: { value: shellEscape, enumerable: true },
  braces: { value: braces, enumerable: true },
  file: { value: (path) => new ShellFile(path), enumerable: true },
});

export { ShellFile };
export default $;
