import { ProcessRunner } from './process-runner.mjs';
import { trace } from './$.trace.mjs';

const identity = (value) => value;
const posixQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const stdioModes = ['pipe', 'inherit', 'ignore'];

function argument(value) {
  if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    throw new TypeError('Command arguments must be strings or scalar values');
  }
  const text = String(value);
  if (text.includes('\0')) {
    throw new TypeError('Command arguments must not contain NUL');
  }
  return text;
}

function stdio(stream, mode) {
  if (!stdioModes.includes(mode)) {
    throw new TypeError(`Invalid ${stream} mode: ${mode}`);
  }
  return mode;
}

function mergeOptions(base, overrides = {}) {
  return {
    ...base,
    ...overrides,
    ...(base.env &&
      overrides.env && { env: { ...base.env, ...overrides.env } }),
  };
}

function snapshotOptions(options) {
  return Object.freeze({
    ...options,
    ...(options.env && { env: Object.freeze({ ...options.env }) }),
    ...(options.ansi && { ansi: Object.freeze({ ...options.ansi }) }),
    ...(Array.isArray(options.preferLocal) && {
      preferLocal: Object.freeze([...options.preferLocal]),
    }),
  });
}

/** An immutable, lazy exact-argv command specification. */
export class CommandBuilder {
  constructor(file, args = [], options = {}, select = identity) {
    if (typeof file !== 'string' || !file || file.includes('\0')) {
      throw new TypeError('Command file must be a nonempty string without NUL');
    }
    if (!Array.isArray(args)) {
      throw new TypeError('Command arguments must be an array');
    }
    for (const stream of ['stdout', 'stderr']) {
      if (options[stream] !== undefined) {
        stdio(stream, options[stream]);
      }
    }
    this.file = file;
    this.args = Object.freeze(args.map(argument));
    this.options = snapshotOptions({
      mirror: false,
      capture: true,
      ...options,
    });
    this.select = select;
    Object.freeze(this);
  }

  get cmd() {
    return this.file;
  }

  arg(...args) {
    return new CommandBuilder(
      this.file,
      [...this.args, ...args],
      this.options,
      this.select
    );
  }

  with(options) {
    return new CommandBuilder(
      this.file,
      this.args,
      mergeOptions(this.options, options),
      this.select
    );
  }

  stdin(input) {
    return this.with({ stdin: input });
  }

  stdout(mode) {
    return this.with({ stdout: stdio('stdout', mode) });
  }

  stderr(mode) {
    return this.with({ stderr: stdio('stderr', mode) });
  }

  env(vars) {
    return this.with({ env: vars });
  }

  cwd(dir) {
    return this.with({ cwd: dir });
  }

  capture(enabled = true) {
    return this.with({ capture: enabled });
  }

  mirror(enabled = true) {
    return this.with({ mirror: enabled });
  }

  exitCode() {
    return new CommandBuilder(
      this.file,
      this.args,
      this.options,
      (result) => result.code
    );
  }

  pipe(...transforms) {
    return transforms.reduce((builder, transform) => {
      if (typeof transform !== 'function') {
        throw new TypeError('Command pipe() expects builder transforms');
      }
      const next = transform(builder);
      if (!(next instanceof CommandBuilder)) {
        throw new TypeError('Command transforms must return a CommandBuilder');
      }
      return next;
    }, this);
  }

  runner(options = {}) {
    const configured = this.with(options);
    trace('CommandBuilder', () => `runner() | file: ${this.file}`);
    return new ProcessRunner(
      { mode: 'exec', file: this.file, args: [...this.args] },
      configured.options
    );
  }

  async run(options) {
    return this.select(await this.runner(options));
  }

  sync(options) {
    return this.select(this.runner(options).sync());
  }

  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }

  stream(options) {
    return this.runner().stream(options);
  }

  toString() {
    return [this.file, ...this.args].map(posixQuote).join(' ');
  }

  buildCommand() {
    return this.toString();
  }
}

function factory(options = {}) {
  const defaults = snapshotOptions(options);
  const make = (file, ...args) => {
    if (Array.isArray(args[0])) {
      if (args.length > 2) {
        throw new TypeError('Use command(file, args, options) for argv arrays');
      }
      return new CommandBuilder(file, args[0], mergeOptions(defaults, args[1]));
    }
    return new CommandBuilder(file, args, defaults);
  };
  for (const stream of ['stdout', 'stderr']) {
    make[stream] = (mode) => {
      stdio(stream, mode);
      return (builder) => builder[stream](mode);
    };
  }
  for (const method of ['arg', 'cwd', 'env', 'stdin', 'capture', 'mirror']) {
    make[method] =
      (...args) =>
      (builder) =>
        builder[method](...args);
  }
  // Factory presets and pipe transforms share the same options vocabulary.
  // `with` on the factory binds defaults; use `options` as a pipe transform.
  make.options = (options) => (builder) => builder.with(options);
  make.with = (options) => factory(mergeOptions(defaults, options));
  make.exitCode = (builder) => builder.exitCode();
  return make;
}

export const command = factory();
