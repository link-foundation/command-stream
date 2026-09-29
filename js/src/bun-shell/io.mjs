// Shell IO primitives, ported from Bun's IO.rs, IOWriter.rs and IOReader.rs
// (src/runtime/shell/).
//
// Output kinds (Bun's `OutKind`):
//   {kind: 'fd', writer, captured}  write through a Writer; `captured` (a
//                                   ByteList or null) receives a copy of every
//                                   byte written (the root stdout/stderr when
//                                   not quiet)
//   {kind: 'pipe'}                  append to the shell env's buffered output
//   {kind: 'ignore'}                discard
// Input kinds (Bun's `InKind`): {kind: 'fd', reader} or {kind: 'ignore'}.

import fs from 'node:fs';
import os from 'node:os';
import { errnoMessage } from './errno.mjs';

/** Growable byte buffer (Bun's `Vec<u8>` used for buffered stdout/stderr). */
export class ByteList {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  append(bytes) {
    if (bytes.length === 0) {
      return;
    }
    this.chunks.push(Buffer.from(bytes));
    this.length += bytes.length;
  }

  toBuffer() {
    if (this.chunks.length !== 1) {
      const buf = Buffer.concat(this.chunks, this.length);
      this.chunks = [buf];
    }
    return this.chunks[0] ?? Buffer.alloc(0);
  }

  toString() {
    return this.toBuffer().toString('utf8');
  }

  clear() {
    this.chunks = [];
    this.length = 0;
  }
}

export function toBytes(data) {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}

/** Numeric (positive) errno for a Node error code such as 'ENOENT'. */
export function errnoOf(code) {
  const n = os.constants.errno[code];
  return typeof n === 'number' ? Math.abs(n) : 0;
}

/**
 * A shell system error (Bun's `SystemError` as used by the shell): `message`
 * is the coreutils-style text ("No such file or directory"), `path` the
 * offending path (may be empty).
 */
export class ShellSysError extends Error {
  constructor(code, { path = '', syscall = '', errno } = {}) {
    const n = errno ?? errnoOf(code);
    super(errnoMessage(code) ?? code);
    this.code = code;
    this.errno = n;
    this.path = path;
    this.syscall = syscall;
  }

  /** Bun's `ShellErr::Sys` display: "bun: {message}: {path}". */
  display() {
    return this.path
      ? `bun: ${this.message}: ${this.path}`
      : `bun: ${this.message}`;
  }
}

/** Convert a Node fs error into a ShellSysError (keeps the path). */
export function sysErrorFromNode(err, path) {
  if (err instanceof ShellSysError) {
    return err;
  }
  const code = err?.code ?? 'EIO';
  const errno =
    typeof err?.errno === 'number' ? Math.abs(err.errno) : errnoOf(code);
  return new ShellSysError(code, {
    path: path ?? err?.path ?? '',
    syscall: err?.syscall ?? '',
    errno: errno || errnoOf(code),
  });
}

/**
 * IOWriter: writes are serialized in enqueue order; every chunk that is
 * written is also teed into the chunk's `captured` ByteList. Errors are
 * sticky: once a write fails (EPIPE marks the writer as broken), every later
 * write fails with the same error without touching the target.
 */
export class Writer {
  constructor(target) {
    this.target = target;
    this.tail = Promise.resolve();
    this.err = null;
    this.refs = 1;
  }

  /** Write bytes; resolves to `null` on success or a ShellSysError. */
  write(data, captured = null) {
    const bytes = toBytes(data);
    const run = async () => {
      if (this.err) {
        return this.err;
      }
      if (bytes.length === 0) {
        return null;
      }
      try {
        await this.target.write(bytes);
      } catch (e) {
        this.err = sysErrorFromNode(e);
        return this.err;
      }
      if (captured) {
        captured.append(bytes);
      }
      return null;
    };
    const p = this.tail.then(run);
    this.tail = p;
    return p;
  }

  ref() {
    this.refs++;
    return this;
  }

  /** Drop a reference; the target is closed once nothing references it. */
  async deref() {
    this.refs--;
    if (this.refs === 0) {
      await this.tail;
      await this.target.close?.();
    }
  }
}

/** Writes to a raw fd with fs.write (redirect targets opened by the shell). */
export class FdTarget {
  constructor(fd, { owned = true } = {}) {
    this.fd = fd;
    this.owned = owned;
    this.closed = false;
  }

  write(bytes) {
    return new Promise((resolve, reject) => {
      let off = 0;
      const step = () => {
        fs.write(this.fd, bytes, off, bytes.length - off, null, (err, n) => {
          if (err) {
            if (err.code === 'EAGAIN') {
              setTimeout(step, 1);
              return;
            }
            reject(err);
            return;
          }
          off += n;
          if (off < bytes.length) {
            step();
          } else {
            resolve();
          }
        });
      };
      step();
    });
  }

  close() {
    if (this.owned && !this.closed) {
      this.closed = true;
      try {
        fs.closeSync(this.fd);
      } catch {
        // Already closed.
      }
    }
  }
}

/** Writes to a Node.js Writable (process.stdout / process.stderr). */
export class StreamTarget {
  constructor(stream) {
    this.stream = stream;
  }

  write(bytes) {
    return new Promise((resolve, reject) => {
      if (this.stream.destroyed || this.stream.writableEnded) {
        const err = new Error('write EPIPE');
        err.code = 'EPIPE';
        reject(err);
        return;
      }
      this.stream.write(bytes, (err) => (err ? reject(err) : resolve()));
    });
  }
}

/**
 * In-memory pipe between two pipeline items (Bun uses a socketpair). The
 * buffer is bounded: writers wait while more than HIGH_WATER bytes are
 * pending. Closing the read end makes pending and later writes fail with
 * EPIPE, like writing to a socket whose peer is gone.
 */
const HIGH_WATER = 64 * 1024;

export class Channel {
  constructor() {
    this.chunks = [];
    this.pending = 0;
    this.writeClosed = false;
    this.readClosed = false;
    this.readWaiters = [];
    this.drainWaiters = [];
  }

  write(bytes) {
    if (this.readClosed) {
      return Promise.reject(epipe());
    }
    this.chunks.push(bytes);
    this.pending += bytes.length;
    this.wakeReaders();
    if (this.pending <= HIGH_WATER) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) =>
      this.drainWaiters.push({ resolve, reject })
    );
  }

  /** Close the write end (EOF for the reader). */
  close() {
    this.writeClosed = true;
    this.wakeReaders();
  }

  /** Close the read end: pending and future writes fail with EPIPE. */
  closeRead() {
    if (this.readClosed) {
      return;
    }
    this.readClosed = true;
    this.chunks = [];
    this.pending = 0;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const w of waiters) {
      w.reject(epipe());
    }
    this.wakeReaders();
  }

  wakeReaders() {
    const waiters = this.readWaiters;
    this.readWaiters = [];
    for (const w of waiters) {
      w();
    }
  }

  /** Next chunk, or null at EOF. */
  async read() {
    for (;;) {
      if (this.chunks.length) {
        const chunk = this.chunks.shift();
        this.pending -= chunk.length;
        if (this.pending <= HIGH_WATER) {
          const waiters = this.drainWaiters;
          this.drainWaiters = [];
          for (const w of waiters) {
            w.resolve();
          }
        }
        return chunk;
      }
      if (this.writeClosed || this.readClosed) {
        return null;
      }
      await new Promise((r) => this.readWaiters.push(r));
    }
  }
}

function epipe() {
  const err = new Error('write EPIPE');
  err.code = 'EPIPE';
  return err;
}

/** Writer target for the write end of a Channel. */
export class ChannelTarget {
  constructor(channel) {
    this.channel = channel;
  }

  write(bytes) {
    return this.channel.write(bytes);
  }

  close() {
    this.channel.close();
  }
}

/**
 * IOReader: the read side of an input. Sources:
 *   {type: 'channel', channel}   a pipeline pipe
 *   {type: 'fd', fd, owned}      a file opened by `< file`
 *   {type: 'stdin'}              the process stdin
 */
export class Reader {
  constructor(source) {
    this.source = source;
    this.refs = 1;
  }

  /** Async iterator over Buffer chunks until EOF. */
  async *chunks() {
    const src = this.source;
    if (src.type === 'channel') {
      for (let c = await src.channel.read(); c; c = await src.channel.read()) {
        yield c;
      }
      return;
    }
    if (src.type === 'fd') {
      const buf = Buffer.alloc(64 * 1024);
      for (;;) {
        const n = await new Promise((resolve, reject) =>
          fs.read(src.fd, buf, 0, buf.length, null, (err, bytes) =>
            err ? reject(err) : resolve(bytes)
          )
        );
        if (n === 0) {
          return;
        }
        yield Buffer.from(buf.subarray(0, n));
      }
    }
    if (src.type === 'stdin') {
      const stdin = globalThis.process?.stdin;
      if (!stdin || stdin.isTTY === undefined) {
        return;
      }
      for await (const c of stdin) {
        yield Buffer.from(c);
      }
    }
  }

  /** Stop reading (a consumer that exits early closes its end of the pipe). */
  close() {
    if (this.source.type === 'channel') {
      this.source.channel.closeRead();
    }
  }

  ref() {
    this.refs++;
    return this;
  }

  deref() {
    this.refs--;
    if (this.refs === 0) {
      this.close();
      if (this.source.type === 'fd' && this.source.owned) {
        try {
          fs.closeSync(this.source.fd);
        } catch {
          // Already closed.
        }
      }
    }
  }
}

export const IGNORE_OUT = Object.freeze({ kind: 'ignore' });
export const PIPE_OUT = Object.freeze({ kind: 'pipe' });
export const IGNORE_IN = Object.freeze({ kind: 'ignore' });

export function fdOut(writer, captured = null) {
  return { kind: 'fd', writer, captured };
}
