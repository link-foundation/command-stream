// The `cat` builtin, ported from Bun's builtin/cat.rs (src/runtime/shell/).
//
// With no file operands cat copies its stdin to stdout. Otherwise it opens
// each file in turn and streams it to stdout. It stops at the first file that
// fails to open, or the first read or write error. A write error ends cat
// with its errno.
//
// Bun 1.4.2 on Linux registers every reader fd with epoll. epoll_ctl fails
// with EPERM for fds that cannot be polled: regular files, directories,
// block devices, /dev/null and similar. The reader then fails before
// reading anything, and cat exits with 1 and prints nothing. For example,
// `cat file` and `cat < file` both do this. Pipes, sockets and ttys work.
// This port reproduces that behavior. One exception: when stdout is an fd,
// Bun hangs on the file-operand case, and this port exits with 1 instead.

import fs from 'node:fs';
import path from 'node:path';
import { Reader, sysErrorFromNode } from '../io.mjs';

const IS_LINUX = process.platform === 'linux';
// Character devices of major 1 that do not support poll (mem, port, null,
// zero, full). /dev/random and /dev/urandom can be polled.
const UNPOLLABLE_MEM_MINORS = new Set([1, 3, 4, 5, 7]);
const EPERM = 1;

/**
 * Bun's `parse_flags` with cat's options: `{start}` (null for no operands),
 * `{illegal: bytes}` or `{unsupported: opt}`. Only the first character of
 * each flag group is looked at.
 */
function parseOpts(args) {
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg.length === 0 || arg[0] !== '-') {
      return { start: idx };
    }
    if (arg.length === 1) {
      return { illegal: Buffer.from('-') };
    }
    const small = Buffer.from(arg.slice(1), 'utf8');
    const ch = String.fromCharCode(small[0]);
    if ('bestuvn'.includes(ch)) {
      return { unsupported: `-${ch}` };
    }
    return { illegal: small.subarray(1) };
  }
  return { start: null };
}

/** Cat's `write_failing_error`: a failed stderr write ends with its errno. */
async function fail(b, msg, exitCode) {
  if (b.needsIO('stderr')) {
    const err = await b.write('stderr', msg);
    return err ? err.errno : exitCode;
  }
  b.writeNoIO('stderr', msg);
  return exitCode;
}

function failOpts(b, parsed) {
  if (parsed.unsupported) {
    return fail(
      b,
      b.fmtErr(
        `unsupported option, please open a GitHub issue -- ${parsed.unsupported}\n`
      ),
      1
    );
  }
  const msg = Buffer.concat([
    Buffer.from(b.fmtErr('illegal option -- ')),
    parsed.illegal,
    Buffer.from('\n'),
  ]);
  return fail(b, msg, 1);
}

/** Whether Bun's epoll registration of `fd` would fail (see above). */
function unpollable(fd) {
  if (!IS_LINUX) {
    return false;
  }
  let st;
  try {
    st = fs.fstatSync(fd);
  } catch {
    return false;
  }
  if (st.isFile() || st.isDirectory() || st.isBlockDevice()) {
    return true;
  }
  if (st.isCharacterDevice()) {
    const major = Math.floor(st.rdev / 256) & 0xfff;
    const minor = (st.rdev & 0xff) | (Math.floor(st.rdev / 4096) & ~0xff);
    return major === 1 && UNPOLLABLE_MEM_MINORS.has(minor);
  }
  return false;
}

function readerFd(reader) {
  const src = reader.source;
  if (src.type === 'fd') {
    return src.fd;
  }
  return src.type === 'stdin' ? 0 : null;
}

/** Stream a reader to stdout: 0, or the errno of a read or write error. */
async function pump(b, reader) {
  const fd = readerFd(reader);
  if (fd !== null && unpollable(fd)) {
    return EPERM;
  }
  const stdoutIO = b.needsIO('stdout');
  try {
    for await (const chunk of reader.chunks()) {
      if (stdoutIO) {
        const err = await b.write('stdout', chunk);
        if (err) {
          return err.errno;
        }
      } else {
        b.writeNoIO('stdout', chunk);
      }
    }
  } catch (e) {
    return sysErrorFromNode(e).errno;
  }
  return 0;
}

async function catStdin(b) {
  if (b.stdinNeedsIO()) {
    return pump(b, b.stdin.reader);
  }
  const buf = b.readStdinNoIO();
  if (b.needsIO('stdout')) {
    const err = await b.write('stdout', buf);
    return err ? err.errno : 0;
  }
  b.writeNoIO('stdout', buf);
  return 0;
}

export async function cat(b) {
  const parsed = parseOpts(b.args);
  if (parsed.start === undefined) {
    return failOpts(b, parsed);
  }
  if (parsed.start === null) {
    return catStdin(b);
  }
  const cwd = b.shell.cwd;
  for (const arg of b.args.slice(parsed.start)) {
    let fd;
    try {
      if (arg.length === 0) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      fd = fs.openSync(
        path.isAbsolute(arg) ? arg : `${cwd.replace(/\/$/, '')}/${arg}`,
        fs.constants.O_RDONLY
      );
    } catch (e) {
      return fail(b, b.taskErrorToString(sysErrorFromNode(e, arg)), 1);
    }
    try {
      const code = await pump(b, new Reader({ type: 'fd', fd }));
      if (code !== 0) {
        return code;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return 0;
}
