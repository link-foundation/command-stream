import { ProcessRunner } from './process-runner.mjs';

const identity = (value) => value;
const posixQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** An immutable, lazy exact-argv command specification. */
export class CommandBuilder {
  constructor(file, args = [], options = {}, select = identity) {
    if (typeof file !== 'string' || !file || file.includes('\0')) {
      throw new TypeError('Command file must be a nonempty string without NUL');
    }
    if (args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new TypeError('Command arguments must be strings without NUL');
    }
    this.file = file;
    this.args = Object.freeze([...args]);
    this.options = Object.freeze({
      mirror: false,
      capture: true,
      ...options,
      ...(options.env && { env: Object.freeze({ ...options.env }) }),
    });
    this.select = select;
    Object.freeze(this);
  }

  with(options) {
    return new CommandBuilder(
      this.file,
      this.args,
      { ...this.options, ...options },
      this.select
    );
  }

  pipe(...transforms) {
    return transforms.reduce((builder, transform) => transform(builder), this);
  }

  runner() {
    return new ProcessRunner(
      { mode: 'exec', file: this.file, args: [...this.args] },
      this.options
    );
  }

  async run() {
    return this.select(await this.runner());
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
}

export function command(file, ...args) {
  return new CommandBuilder(file, args);
}

for (const stream of ['stdout', 'stderr']) {
  command[stream] = (mode) => {
    if (!['pipe', 'inherit', 'ignore'].includes(mode)) {
      throw new TypeError(`Invalid ${stream} mode: ${mode}`);
    }
    return (builder) => builder.with({ [stream]: mode });
  };
}
command.cwd = (cwd) => (builder) => builder.with({ cwd });
command.env = (env) => (builder) => builder.with({ env });
command.stdin = (stdin) => (builder) => builder.with({ stdin });
command.exitCode = (builder) =>
  new CommandBuilder(
    builder.file,
    builder.args,
    builder.options,
    (result) => result.code
  );
