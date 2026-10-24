// zx-compatible ProcessOutput: the settled result of a `$` command (issue #26).

import { Buffer } from 'node:buffer';
import { inspect } from 'node:util';
import { Fail } from './error.mjs';
import { chalk } from './vendor-core.mjs';
import { bufArrJoin, getLines, iteratorToArray, once } from './util.mjs';

export const DLMTR = /\r?\n/;

// Late-bound accessor for `$.delimiter`, installed by core.mjs.
let globalDelimiter = () => undefined;
export const setGlobalDelimiter = (getter) => {
  globalDelimiter = getter;
};

const toDto = ([
  code = null,
  signal = null,
  stdout = '',
  stderr = '',
  stdall = '',
  message = '',
  duration = 0,
  error = null,
  from = '',
  store = { stdout: [stdout], stderr: [stderr], stdall: [stdall] },
]) => ({ dto: { code, signal, duration, error, from, store }, message });

export class ProcessOutput extends Error {
  /**
   * Accepts either a DTO `{code, signal, duration, error, from, store}` or
   * the legacy positional form
   * `(code, signal, stdout, stderr, stdall, message, duration)`.
   *
   * @param {...any} args DTO or positional values.
   */
  constructor(...args) {
    const [first] = args;
    const isDto = first !== null && typeof first === 'object';
    const { dto, message } = isDto ? { dto: first, message: '' } : toDto(args);
    super(message);
    const self = this;
    Object.defineProperties(this, {
      _dto: { value: dto, enumerable: false },
      cause: { get: () => dto.error, enumerable: false },
      stdout: { get: once(() => bufArrJoin(dto.store.stdout)) },
      stderr: { get: once(() => bufArrJoin(dto.store.stderr)) },
      stdall: { get: once(() => bufArrJoin(dto.store.stdall)) },
      message: {
        get: once(() => ProcessOutput.describe(self, dto, message)),
      },
    });
  }

  static describe(output, dto, message) {
    if (dto.error || message) {
      return ProcessOutput.getErrorMessage(
        dto.error || new Error(message),
        dto.from
      );
    }
    const { stderr } = output;
    const details = stderr.trim()
      ? ''
      : ProcessOutput.getErrorDetails(output.lines());
    return ProcessOutput.getExitMessage(
      dto.code,
      dto.signal,
      stderr,
      dto.from,
      details
    );
  }

  get exitCode() {
    return this._dto.code;
  }

  get signal() {
    return this._dto.signal;
  }

  get duration() {
    return this._dto.duration;
  }

  get [Symbol.toStringTag]() {
    return 'ProcessOutput';
  }

  get ok() {
    return !this._dto.error && this.exitCode === 0;
  }

  json() {
    return JSON.parse(this.stdall);
  }

  buffer() {
    return Buffer.from(this.stdall);
  }

  blob(type = 'text/plain') {
    if (!globalThis.Blob) {
      throw new Fail(
        'Blob is not supported in this environment. Provide a polyfill'
      );
    }
    return new globalThis.Blob([this.buffer()], { type });
  }

  text(encoding = 'utf8') {
    return encoding === 'utf8'
      ? this.toString()
      : this.buffer().toString(encoding);
  }

  lines(delimiter) {
    return iteratorToArray(this[Symbol.iterator](delimiter));
  }

  toString() {
    return this.stdall;
  }

  valueOf() {
    return this.stdall.trim();
  }

  [Symbol.toPrimitive]() {
    return this.valueOf();
  }

  *[Symbol.iterator](
    delimiter = this._dto.delimiter || globalDelimiter() || DLMTR
  ) {
    const memo = [];
    for (const chunk of this._dto.store.stdall) {
      yield* getLines(chunk, memo, delimiter);
    }
    if (memo[0]) {
      yield memo[0];
    }
  }

  [inspect.custom]() {
    const codeInfo = ProcessOutput.getExitCodeInfo(this.exitCode);
    const paint = this.ok ? chalk.green : chalk.red;
    const info = codeInfo ? chalk.grey(` (${codeInfo})`) : '';
    return [
      'ProcessOutput {',
      `  stdout: ${chalk.green(inspect(this.stdout))},`,
      `  stderr: ${chalk.red(inspect(this.stderr))},`,
      `  signal: ${inspect(this.signal)},`,
      `  exitCode: ${paint(this.exitCode)}${info},`,
      `  duration: ${this.duration}`,
      '}',
    ].join('\n');
  }

  static getExitMessage = Fail.formatExitMessage;
  static getErrorMessage = Fail.formatErrorMessage;
  static getErrorDetails = Fail.formatErrorDetails;
  static getExitCodeInfo = Fail.getExitCodeInfo;

  static fromError(error) {
    const output = new ProcessOutput();
    output._dto.error = error;
    return output;
  }
}
