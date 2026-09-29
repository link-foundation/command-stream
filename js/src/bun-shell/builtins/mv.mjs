// The `mv` builtin, ported from Bun's builtin/mv.rs (src/runtime/shell/).
//
// Bun first opens the target as a directory on a worker thread, then moves
// the sources in batches of 5, one thread-pool task per batch. A batch moves
// its sources in order and stops at its first error. The batches run
// concurrently, and the first batch error to arrive is reported. This port
// runs the batches one after another and reports the first batch's error.
// Paths are resolved against the cwd like `openat(cwd, p)`: they are joined
// but not normalized.

import fs from '../fs.mjs';
import path from 'node:path';
import { USAGE } from '../builtin.mjs';
import { errnoMessage } from '../errno.mjs';
import { ShellSysError, sysErrorFromNode } from '../io.mjs';

const { O_RDONLY, O_WRONLY, O_CREAT, O_TRUNC, O_DIRECTORY, O_NOFOLLOW } =
  fs.constants;
const BATCH_SIZE = 5;

/** `openat(cwd, p)`: absolute paths as is, others joined onto the cwd. */
function atPath(cwd, p) {
  if (p.length === 0 || path.isAbsolute(p)) {
    return p;
  }
  return cwd.endsWith('/') ? cwd + p : `${cwd}/${p}`;
}

/** Bun's `resolve_path::basename` (either separator). */
function basenameAny(p) {
  if (p.length === 0) {
    return '';
  }
  const isSep = (c) => c === '/' || c === '\\';
  let end = p.length - 1;
  while (isSep(p[end])) {
    if (end === 0) {
      return '/';
    }
    end--;
  }
  let start = end;
  while (!isSep(p[start])) {
    if (start === 0) {
      return p.slice(0, end + 1);
    }
    start--;
  }
  return p.slice(start + 1, end + 1);
}

/** Bun's `Mv::parse_opts`: `{start}` or `{error: message}`. */
function parseOpts(args) {
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg.length === 0 || arg[0] !== '-') {
      return args.length - idx < 2 ? { error: USAGE.mv } : { start: idx };
    }
    // Every flag character must be one of -fhinv (all ignored).
    for (const ch of arg.slice(1)) {
      if (!'fhinv'.includes(ch)) {
        return { error: 'mv: illegal option -- -\n' };
      }
    }
  }
  return { error: USAGE.mv };
}

/** Mv's `write_failing_error`: a failed stderr write ends with 1. */
async function fail(b, msg, exitCode) {
  if (b.needsIO('stderr')) {
    return (await b.write('stderr', msg)) ? 1 : exitCode;
  }
  b.writeNoIO('stderr', msg);
  return exitCode;
}

/** A Node fs error as a Bun sys error carrying `p` (the syscall's path). */
function sysErr(e, p) {
  return sysErrorFromNode(e, p);
}

function tryClose(fd) {
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed.
  }
}

/** Copy the whole of `inFd` to `outFd` (Bun's `copy_file`). */
function copyData(inFd, outFd) {
  const buf = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const n = fs.readSync(inFd, buf, 0, buf.length, null);
    if (n === 0) {
      return;
    }
    let off = 0;
    while (off < n) {
      off += fs.writeSync(outFd, buf, off, n - off);
    }
  }
}

/**
 * EXDEV fallback: copy `src` to `dst`, then remove `src`. `srcName` and
 * `dstName` are the names the `*at` syscalls see; errors carry them.
 */
function moveAcrossDevices(src, srcName, dst, dstName) {
  let st;
  try {
    st = fs.lstatSync(src);
  } catch (e) {
    return sysErr(e, srcName);
  }
  try {
    const d = fs.lstatSync(dst);
    if (d.dev === st.dev && d.ino === st.ino) {
      return null;
    }
  } catch {
    // No destination yet.
  }
  if (st.isSymbolicLink()) {
    let link;
    try {
      link = fs.readlinkSync(src, { encoding: 'buffer' });
    } catch (e) {
      return sysErr(e, srcName);
    }
    try {
      fs.unlinkSync(dst);
    } catch {
      // Nothing to replace.
    }
    try {
      fs.symlinkSync(link, dst);
    } catch (e) {
      return sysErr(e, dstName);
    }
    return unlinkAt(src, srcName);
  }
  if (st.isDirectory()) {
    return moveDirAcrossDevices(st, src, srcName, dst, dstName);
  }
  if (!st.isFile()) {
    // Opening a FIFO without O_NONBLOCK would block forever.
    return new ShellSysError('ENOTSUP', { syscall: 'rename' });
  }
  let inFd;
  try {
    inFd = fs.openSync(src, O_RDONLY | O_NOFOLLOW);
  } catch (e) {
    return sysErr(e, srcName);
  }
  let outFd = null;
  try {
    const fst = fs.fstatSync(inFd);
    if (fst.dev !== st.dev || fst.ino !== st.ino) {
      return new ShellSysError('ENOENT', { syscall: 'rename' });
    }
    const mode = fst.mode & 0o7777;
    try {
      fs.unlinkSync(dst);
    } catch {
      // Nothing to replace.
    }
    try {
      outFd = fs.openSync(dst, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, mode);
    } catch (e) {
      return sysErr(e, dstName);
    }
    try {
      copyData(inFd, outFd);
    } catch (e) {
      tryClose(outFd);
      outFd = null;
      try {
        fs.unlinkSync(dst);
      } catch {
        // Already gone.
      }
      return sysErr(e, '');
    }
    try {
      fs.fchownSync(outFd, fst.uid, fst.gid);
    } catch {
      // Best effort.
    }
    try {
      fs.fchmodSync(outFd, mode);
    } catch {
      // Best effort.
    }
  } finally {
    tryClose(inFd);
    if (outFd !== null) {
      tryClose(outFd);
    }
  }
  return unlinkAt(src, srcName);
}

function unlinkAt(p, name) {
  try {
    fs.unlinkSync(p);
    return null;
  } catch (e) {
    return sysErr(e, name);
  }
}

function moveDirAcrossDevices(st, src, srcName, dst, dstName) {
  let sfd;
  try {
    sfd = fs.openSync(src, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  } catch (e) {
    return sysErr(e, srcName);
  }
  try {
    const sst = fs.fstatSync(sfd);
    if (sst.dev !== st.dev || sst.ino !== st.ino) {
      return new ShellSysError('ENOENT', { syscall: 'rename' });
    }
    const mode = sst.mode & 0o7777;
    // `| 0o700` so children can be written; the mode is restored below.
    try {
      fs.mkdirSync(dst, { mode: mode | 0o700 });
    } catch (e) {
      if (e.code !== 'EEXIST') {
        return sysErr(e, dstName);
      }
      // Refuse to merge into a non-empty destination (ENOTEMPTY).
      try {
        fs.rmdirSync(dst);
        fs.mkdirSync(dst, { mode: mode | 0o700 });
      } catch (e2) {
        return sysErr(e2, dstName);
      }
    }
    let dfd;
    try {
      dfd = fs.openSync(dst, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    } catch (e) {
      return sysErr(e, dstName);
    }
    try {
      let dir;
      try {
        dir = fs.opendirSync(src);
      } catch (e) {
        return sysErr(e, '');
      }
      try {
        for (let ent = dir.readSync(); ent; ent = dir.readSync()) {
          const err = moveAcrossDevices(
            `${src}/${ent.name}`,
            ent.name,
            `${dst}/${ent.name}`,
            ent.name
          );
          if (err) {
            return err;
          }
        }
      } catch (e) {
        return sysErr(e, '');
      } finally {
        dir.closeSync();
      }
      try {
        fs.fchownSync(dfd, sst.uid, sst.gid);
      } catch {
        // Best effort.
      }
      try {
        fs.fchmodSync(dfd, mode);
      } catch {
        // Best effort.
      }
    } finally {
      tryClose(dfd);
    }
  } finally {
    tryClose(sfd);
  }
  try {
    fs.rmdirSync(src);
    return null;
  } catch (e) {
    return sysErr(e, srcName);
  }
}

/** `renameat()`, falling back to a copy on EXDEV. Errors carry `srcName`. */
function doRename(src, srcName, dst, dstName) {
  try {
    fs.renameSync(src, dst);
    return null;
  } catch (e) {
    if (e.code !== 'EXDEV') {
      return sysErr(e, srcName);
    }
  }
  const err = moveAcrossDevices(src, srcName, dst, dstName);
  if (err && !err.path) {
    err.path = srcName;
  }
  return err;
}

/** Move `src` to `target/basename(src)`; errors carry that joined path. */
function moveInDir(cwd, target, src) {
  const base = path.normalize(basenameAny(src));
  const err = doRename(
    atPath(cwd, src),
    src,
    `${atPath(cwd, target)}/${base}`,
    base
  );
  if (err) {
    err.path = path.join(target, basenameAny(src));
  }
  return err;
}

/** ShellMvCheckTargetTask: true if the target opens as a directory. */
function targetIsDir(cwd, target) {
  try {
    fs.closeSync(fs.openSync(atPath(cwd, target), O_RDONLY | O_DIRECTORY));
    return true;
  } catch (e) {
    if (e.code === 'ENOTDIR') {
      return false;
    }
    return e;
  }
}

export async function mv(b) {
  const parsed = parseOpts(b.args);
  if (parsed.error) {
    return fail(b, parsed.error, 1);
  }
  const cwd = b.shell.cwd;
  const target = b.args[b.args.length - 1];
  const sources = b.args.slice(parsed.start, -1);
  let isDir = targetIsDir(cwd, target);
  if (isDir instanceof Error) {
    if (isDir.code !== 'ENOENT') {
      const msg = errnoMessage(isDir.code) ?? 'unknown error';
      return fail(b, `mv: ${target}: ${msg}\n`, 1);
    }
    if (sources.length !== 1) {
      return fail(b, `mv: ${target}: No such file or directory\n`, 1);
    }
    isDir = false;
  }
  if (!isDir && sources.length > 1) {
    return fail(b, `mv: ${target} is not a directory\n`, 1);
  }
  if (!isDir) {
    const err = doRename(
      atPath(cwd, sources[0]),
      sources[0],
      atPath(cwd, target),
      target
    );
    if (err?.code === 'ENOTDIR') {
      err.path = target;
    }
    return err ? fail(b, b.taskErrorToString(err), err.errno) : 0;
  }
  // Bun runs each batch on its own task; each stops at its first error.
  let first = null;
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    for (const src of sources.slice(i, i + BATCH_SIZE)) {
      const err = moveInDir(cwd, target, src);
      if (err) {
        first ??= err;
        break;
      }
    }
  }
  if (!first) {
    return 0;
  }
  const code = await fail(b, b.taskErrorToString(first), first.errno);
  return code;
}
