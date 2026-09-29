// The `cp` builtin, ported from Bun's builtin/cp.rs (src/runtime/shell/) and
// NodeFS's shell copy (NewAsyncCpTask, copy_single_file_sync, cp_symlink and
// mkdir_recursive in src/runtime/node/node_fs.rs).
//
// Bun copies each source on its own thread-pool task. With -R, a directory
// is scanned depth first: each directory is created as it is reached, and
// every non-directory entry gets its own concurrent copy task. Each task's
// output (its error to stderr first, then the -v lines to stdout) is written
// as the task finishes. This port copies the sources one at a time, in
// argument order. Within a directory it creates all the directories first,
// then copies the files in scan order.

import fs from '../fs.mjs';
import path from 'node:path';
import { USAGE } from '../builtin.mjs';
import { ShellSysError, sysErrorFromNode } from '../io.mjs';

const { O_RDONLY, O_WRONLY, O_CREAT, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } =
  fs.constants;

/**
 * Bun's `parse_flags` with cp's options: `{recursive, verbose, rest}`,
 * `{usage: true}`, `{illegal: bytes}` or `{unsupported: opt}`. Only the first
 * character of each flag group counts (`-Rv` is just -R).
 */
function parseOpts(args) {
  const opts = { recursive: false, verbose: false };
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg.length === 0 || arg[0] !== '-') {
      return { ...opts, rest: args.slice(idx) };
    }
    if (arg.length === 1) {
      return { illegal: Buffer.from('-') };
    }
    const ch = arg[1];
    if ('fHiLP'.includes(ch)) {
      return { unsupported: `-${ch}` };
    }
    if (ch === 'p') {
      return { unsupported: '-P' };
    }
    if (ch === 'R') {
      opts.recursive = true;
    } else if (ch === 'v') {
      opts.verbose = true;
    } else if (ch !== 'n') {
      return { illegal: Buffer.from(arg.slice(1), 'utf8') };
    }
  }
  return { usage: true };
}

function failOpts(b, parsed) {
  if (parsed.usage || parsed.rest) {
    return b.writeFailingError(USAGE.cp, 1);
  }
  if (parsed.unsupported) {
    return b.failParse({ type: 'unsupported', opt: parsed.unsupported });
  }
  const msg = Buffer.concat([
    Buffer.from(b.fmtErr('illegal option -- ')),
    parsed.illegal,
    Buffer.from('\n'),
  ]);
  return b.writeFailingError(msg, 1);
}

function sysErr(e, p) {
  return sysErrorFromNode(e, p);
}

function tryMkdir(p) {
  try {
    fs.mkdirSync(p, { mode: 0o777 });
    return null;
  } catch (e) {
    return e;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** NodeFS::mkdir_recursive_impl, with the paths its errors report. */
function mkdirRecursive(p) {
  const err = tryMkdir(p);
  if (err === null) {
    return null;
  }
  if (err.code === 'EEXIST' || err.code === 'EISDIR') {
    return isDirectory(p) ? null : sysErr(err, p);
  }
  if (err.code !== 'ENOENT') {
    return sysErr(err, p);
  }
  if (p.length === 0) {
    return sysErr(err, '');
  }
  let i = p.length - 1;
  for (; i > 0; i--) {
    if (p[i] !== '/') {
      continue;
    }
    const e = tryMkdir(p.slice(0, i));
    if (e === null || e.code === 'EEXIST') {
      break;
    }
    if (e.code !== 'ENOENT') {
      return sysErr(e, p.slice(0, i));
    }
  }
  for (i++; i < p.length; i++) {
    if (p[i] === '/') {
      const e = tryMkdir(p.slice(0, i));
      if (e !== null && e.code !== 'EEXIST') {
        return sysErr(e, p);
      }
    }
  }
  const e = tryMkdir(p);
  return e !== null && e.code !== 'EEXIST' ? sysErr(e, p) : null;
}

/** Bun's `cp_symlink`: recreate the link, relative targets made absolute. */
function cpSymlink(src, dest) {
  let target;
  try {
    target = fs.readlinkSync(src);
  } catch (e) {
    return sysErr(e, src);
  }
  if (!path.isAbsolute(target)) {
    target = path.resolve(path.dirname(src), target);
  }
  try {
    fs.symlinkSync(target, dest);
    return null;
  } catch (e) {
    return sysErr(e, dest);
  }
}

/** `cp_open_dest_with_mkdir`: on ENOENT create the parents and retry. */
function openDest(dest, mode) {
  const flags = O_CREAT | O_WRONLY;
  try {
    return fs.openSync(dest, flags, mode);
  } catch (e) {
    if (e.code === 'ENOENT') {
      const mkdirErr = mkdirRecursive(dest.slice(0, dest.lastIndexOf('/') + 1));
      if (mkdirErr) {
        return mkdirErr;
      }
      try {
        return fs.openSync(dest, flags, mode);
      } catch {
        // Report the first error.
      }
    }
    return sysErr(e, dest);
  }
}

/**
 * Bun's `copy_single_file_sync` (Linux): symlinks are recreated, other
 * non-regular files fail with ENOTSUP, and the destination is written in
 * place (no O_TRUNC), then truncated to the copied size and given the
 * source's mode. Bun's open of a FIFO source blocks until a writer appears;
 * this port opens it with O_NONBLOCK and reports ENOTSUP right away.
 */
function copySingleFile(src, dest) {
  let inFd;
  try {
    inFd = fs.openSync(src, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    return e.code === 'ELOOP' ? cpSymlink(src, dest) : sysErr(e, src);
  }
  try {
    const st = fs.fstatSync(inFd);
    if (!st.isFile()) {
      return new ShellSysError('ENOTSUP', { syscall: 'copyfile' });
    }
    const mode = st.mode & 0o7777;
    const outFd = openDest(dest, mode);
    if (outFd instanceof Error) {
      return outFd;
    }
    let written = 0;
    try {
      const buf = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        const n = fs.readSync(inFd, buf, 0, buf.length, null);
        if (n === 0) {
          break;
        }
        let off = 0;
        while (off < n) {
          off += fs.writeSync(outFd, buf, off, n - off);
        }
        written += n;
      }
    } catch (e) {
      return sysErr(e, dest);
    } finally {
      try {
        fs.ftruncateSync(outFd, written);
        fs.fchmodSync(outFd, mode);
      } catch {
        // Best effort.
      }
      fs.closeSync(outFd);
    }
    return null;
  } finally {
    fs.closeSync(inFd);
  }
}

/**
 * The -R directory copy: create `dest` and every subdirectory (depth first),
 * then copy the other entries. An EEXIST from an entry is ignored; otherwise
 * the first error wins.
 */
function copyDir(src, dest, onCopy) {
  const files = [];
  let first = null;
  const scan = (s, d) => {
    try {
      fs.closeSync(fs.openSync(s, O_DIRECTORY | O_RDONLY | O_NOFOLLOW));
    } catch (e) {
      first = sysErr(e, s);
      return false;
    }
    const err = mkdirRecursive(d);
    if (err) {
      first = err;
      return false;
    }
    onCopy(s, d);
    let dir;
    try {
      dir = fs.opendirSync(s);
    } catch (e) {
      first = sysErr(e, s);
      return false;
    }
    try {
      for (let ent = dir.readSync(); ent; ent = dir.readSync()) {
        const cs = `${s}/${ent.name}`;
        const cd = `${d}/${ent.name}`;
        if (ent.isDirectory()) {
          if (!scan(cs, cd)) {
            return false;
          }
        } else {
          files.push([cs, cd]);
        }
      }
    } catch (e) {
      first = sysErr(e, s);
      return false;
    } finally {
      dir.closeSync();
    }
    return true;
  };
  scan(src, dest);
  for (const [s, d] of files) {
    const err = copySingleFile(s, d);
    if (err === null) {
      onCopy(s, d);
    } else if (err.code !== 'EEXIST' && first === null) {
      first = err;
    }
  }
  return first;
}

/** NewAsyncCpTask::cp_async with force and without error_on_exist. */
function cpAsync(src, dest, recursive, onCopy) {
  let st;
  try {
    st = fs.lstatSync(src);
  } catch (e) {
    return sysErr(e, src);
  }
  if (!st.isDirectory()) {
    const err = copySingleFile(src, dest);
    onCopy(src, dest);
    return err?.code === 'EEXIST' ? null : err;
  }
  if (!recursive) {
    return new ShellSysError('EISDIR', { path: src, syscall: 'copyfile' });
  }
  return copyDir(src, dest, onCopy);
}

/** `lstat(p)` is a directory, or a sys error. */
function isDir(p) {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch (e) {
    return sysErr(e, p);
  }
}

/** A custom (non-sys) shell error. */
function custom(message) {
  return { message };
}

/** One ShellCpTask: `{err, out}` for copying `rawSrc` to `rawTgt`. */
function cpOne(opts, operands, rawSrc, rawTgt, cwd) {
  const abs = (p) => (path.isAbsolute(p) ? path.join(p) : path.join(cwd, p));
  const src = abs(rawSrc);
  let tgt = abs(rawTgt);
  let out = '';
  const onCopy = (s, d) => {
    if (opts.verbose) {
      out += `${s} -> ${d}\n`;
    }
  };
  const srcIsDir = isDir(src);
  if (srcIsDir instanceof Error) {
    return { err: srcIsDir, out };
  }
  if (srcIsDir && !opts.recursive) {
    return { err: custom(`${rawSrc} is a directory (not copied)`), out };
  }
  if (!srcIsDir && src === tgt) {
    return {
      err: custom(`${rawSrc} and ${rawSrc} are identical (not copied)`),
      out,
    };
  }
  let tgtIsDir = isDir(tgt);
  let tgtExists = true;
  if (tgtIsDir instanceof Error) {
    if (tgtIsDir.code !== 'ENOENT') {
      return { err: tgtIsDir, out };
    }
    tgtIsDir = tgt.endsWith('/');
    tgtExists = false;
  }
  if (!srcIsDir && !tgtIsDir && operands === 2) {
    // Copy to the target path itself.
  } else if (opts.recursive) {
    if (tgtExists) {
      tgt = path.join(tgt, basenameAny(src));
    } else if (operands !== 2) {
      return { err: custom(`directory ${rawTgt} does not exist`), out };
    }
  } else {
    if (srcIsDir) {
      return { err: custom(`${rawSrc} is a directory (not copied)`), out };
    }
    if (!tgtExists || !tgtIsDir) {
      return { err: custom(`${rawTgt} is not a directory`), out };
    }
    tgt = path.join(tgt, basenameAny(src));
  }
  const err = cpAsync(src, tgt, opts.recursive, onCopy);
  return { err, out };
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

export async function cp(b) {
  const parsed = parseOpts(b.args);
  if (!parsed.rest || parsed.rest.length <= 1) {
    return failOpts(b, parsed);
  }
  const { rest } = parsed;
  const target = rest[rest.length - 1];
  let failed = false;
  for (const src of rest.slice(0, -1)) {
    const { err, out } = cpOne(parsed, rest.length, src, target, b.shell.cwd);
    if (err) {
      failed = true;
      await b.write('stderr', b.shellErrToString(err));
    }
    await b.write('stdout', out);
  }
  return failed ? 1 : 0;
}
