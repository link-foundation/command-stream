// File references for the shell (`$.file(path)`), the portable counterpart of
// `Bun.file(path)`: interpolated into a script, a file reference becomes its
// path, so `cmd > ${$.file('out.txt')}` writes to out.txt on every runtime.

import fs from './fs.mjs';

/** Symbol under which a file reference stores its path. */
export const FILE_PATH = Symbol.for('command-stream.bun-shell.file-path');

function isInstance(value, name) {
  const ctor = globalThis[name];
  return typeof ctor === 'function' && value instanceof ctor;
}

/** Path of a file reference (`$.file()` or `Bun.file()`), else null. */
export function filePathOf(value) {
  if (value && typeof value[FILE_PATH] === 'string') {
    return value[FILE_PATH];
  }
  if (
    isInstance(value, 'Blob') &&
    typeof value.exists === 'function' &&
    typeof value.name === 'string'
  ) {
    return value.name;
  }
  return null;
}

/** A lazily read file, with the reading half of Bun's `BunFile` API. */
export class ShellFile {
  constructor(path) {
    if (typeof path !== 'string' && !(path instanceof URL)) {
      throw new TypeError('file path must be a string or URL');
    }
    this.name = typeof path === 'string' ? path : path.pathname;
    this[FILE_PATH] = this.name;
  }

  get size() {
    try {
      return fs.statSync(this.name).size;
    } catch {
      return 0;
    }
  }

  async exists() {
    try {
      await fs.promises.access(this.name);
      return true;
    } catch {
      return false;
    }
  }

  async bytes() {
    return new Uint8Array(await fs.promises.readFile(this.name));
  }

  async arrayBuffer() {
    return (await this.bytes()).buffer;
  }

  text() {
    return fs.promises.readFile(this.name, 'utf8');
  }

  async json() {
    return JSON.parse(await this.text());
  }

  toString() {
    return this.name;
  }
}
