import { Readable, Writable } from 'node:stream';

/** A one-shot readable view of the bytes captured by a completed command. */
export class CapturedReadable extends Readable {
  constructor(value = '') {
    super();
    this.value = String(value ?? '');
    this.sent = false;
  }

  _read() {
    if (this.sent) {
      return;
    }
    this.sent = true;
    if (this.value) {
      this.push(Buffer.from(this.value));
    }
    this.push(null);
  }

  toString() {
    return this.value;
  }

  valueOf() {
    return this.value;
  }

  [Symbol.toPrimitive]() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }

  get length() {
    return this.value.length;
  }
}

// Keep common text operations usable while callers move to explicit text().
for (const name of [
  'trim',
  'trimStart',
  'trimEnd',
  'slice',
  'split',
  'includes',
  'startsWith',
  'endsWith',
  'indexOf',
  'lastIndexOf',
  'match',
  'matchAll',
  'replace',
  'replaceAll',
  'search',
  'substring',
  'toLowerCase',
  'toUpperCase',
  'at',
]) {
  CapturedReadable.prototype[name] = function (...args) {
    return String.prototype[name].apply(this.value, args);
  };
}

/** A writable record of input sent to a completed command. New writes are local. */
export class CapturedWritable extends Writable {
  constructor(value = '') {
    super();
    this.chunks = [String(value ?? '')];
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    );
    callback();
  }

  toString() {
    return this.chunks.join('');
  }

  valueOf() {
    return this.toString();
  }

  [Symbol.toPrimitive]() {
    return this.toString();
  }

  toJSON() {
    return this.toString();
  }
}

const streamResults = new WeakMap();

/** Return the public stream view without changing the runner's text result. */
export function toStreamResult(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }
  if (streamResults.has(result)) {
    return streamResults.get(result);
  }
  const stdoutText = String(result.stdout ?? '');
  const stderrText = String(result.stderr ?? '');
  const stdinText = String(result.stdin ?? '');
  const view = {
    ...result,
    stdout:
      result.stdout === undefined
        ? undefined
        : new CapturedReadable(stdoutText),
    stderr:
      result.stderr === undefined
        ? undefined
        : new CapturedReadable(stderrText),
    stdin: new CapturedWritable(stdinText),
    text: () => Promise.resolve(stdoutText),
  };
  streamResults.set(result, view);
  return view;
}
