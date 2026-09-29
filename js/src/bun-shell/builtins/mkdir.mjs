// The `mkdir` builtin, ported from Bun's builtin/mkdir.rs (src/runtime/shell/)
// and NodeFS::mkdir_recursive_impl (src/runtime/node/node_fs.rs).
//
// Bun creates every operand in its own thread-pool task and writes each
// task's output (its error to stderr first, then the -v lines to stdout) as
// the task completes. This port runs the operands one at a time, in argument
// order. A relative operand is joined onto the cwd (normalized, keeping a
// trailing slash); an absolute operand is used as written. Errors always
// report that full path.

import fs from 'node:fs';
import path from 'node:path';
import { sysErrorFromNode } from '../io.mjs';

const IS_WINDOWS = process.platform === 'win32';
const MAX_PATH_BYTES = IS_WINDOWS
  ? 98302
  : process.platform === 'darwin'
    ? 1024
    : 4096;
const isSep = IS_WINDOWS ? (c) => c === '/' || c === '\\' : (c) => c === '/';

/**
 * Bun's `parse_flags` with mkdir's options: `{parents, verbose, start}`,
 * `{usage: true}`, `{illegal: bytes}` or `{unsupported: opt}`.
 */
function parseOpts(args) {
  const opts = { parents: false, verbose: false };
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg.length === 0 || arg[0] !== '-') {
      return { ...opts, start: idx };
    }
    if (arg.length === 1) {
      return { illegal: Buffer.from('-') };
    }
    if (arg.length > 2 && arg[1] === '-') {
      if (arg === '--mode') {
        return { unsupported: '--mode' };
      }
      if (arg === '--parents') {
        opts.parents = true;
        continue;
      }
      // Bun only recognizes this misspelling (--verbose is illegal).
      if (arg === '--vebose') {
        opts.verbose = true;
        continue;
      }
    }
    const small = Buffer.from(arg.slice(1), 'utf8');
    for (let i = 0; i < small.length; i++) {
      const ch = small[i];
      if (ch === 0x6d) {
        return { unsupported: '-m ' };
      }
      if (ch === 0x70) {
        opts.parents = true;
      } else if (ch === 0x76) {
        opts.verbose = true;
      } else {
        return { illegal: small.subarray(i + 1) };
      }
    }
  }
  return { usage: true };
}

/** Report an option error like Bun's `fail_parse` (keeps raw opt bytes). */
function failOpts(b, parsed) {
  if (parsed.usage) {
    return b.failParse({ type: 'usage' });
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

async function tryMkdir(p) {
  try {
    await fs.promises.mkdir(p, { mode: 0o777 });
    return null;
  } catch (e) {
    return e;
  }
}

async function isDirectory(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * NodeFS::mkdir_recursive_impl: try the full path, walk back to the first
 * parent that can be created (or exists), then create the rest going
 * forward. `onCreate` gets each created path (and the final path even when
 * it already existed at the last step, like Bun). Returns an error or null.
 */
async function mkdirRecursive(p, onCreate) {
  const err = await tryMkdir(p);
  if (err === null) {
    onCreate(p);
    return null;
  }
  if (err.code === 'EEXIST' || err.code === 'EISDIR') {
    return (await isDirectory(p)) ? null : err;
  }
  if (err.code !== 'ENOENT' || p.length === 0) {
    return err;
  }
  let i = p.length - 1;
  for (; i > 0; i--) {
    if (!isSep(p[i])) {
      continue;
    }
    const parent = p.slice(0, i);
    const e = await tryMkdir(parent);
    if (e === null) {
      onCreate(parent);
      break;
    }
    if (e.code === 'EEXIST') {
      if (IS_WINDOWS && !(await isDirectory(parent))) {
        return Object.assign(e, { code: 'ENOTDIR' });
      }
      break;
    }
    if (e.code !== 'ENOENT') {
      return e;
    }
  }
  for (i++; i < p.length; i++) {
    if (!isSep(p[i])) {
      continue;
    }
    const parent = p.slice(0, i);
    const e = await tryMkdir(parent);
    if (e === null) {
      onCreate(parent);
    } else if (e.code !== 'EEXIST') {
      return e;
    }
  }
  const e = await tryMkdir(p);
  if (e !== null && e.code !== 'EEXIST') {
    return e;
  }
  onCreate(p);
  return null;
}

/** One ShellMkdirTask: `{err, out}` (err a ShellSysError or null). */
async function mkdirOne(opts, cwd, arg) {
  const filepath = path.isAbsolute(arg) ? arg : path.join(cwd, arg);
  if (Buffer.byteLength(filepath) >= MAX_PATH_BYTES) {
    return {
      err: sysErrorFromNode(
        { code: 'ENAMETOOLONG', syscall: 'mkdir' },
        filepath
      ),
      out: '',
    };
  }
  let out = '';
  let e;
  if (opts.parents) {
    e = await mkdirRecursive(filepath, (dir) => {
      if (opts.verbose) {
        out += `${dir}\n`;
      }
    });
  } else {
    e = await tryMkdir(filepath);
    if (e === null && opts.verbose) {
      out = `${filepath}\n`;
    }
  }
  return { err: e ? sysErrorFromNode(e, filepath) : null, out };
}

export async function mkdir(b) {
  const parsed = parseOpts(b.args);
  if (parsed.start === undefined) {
    return failOpts(b, parsed);
  }
  let failed = false;
  for (const arg of b.args.slice(parsed.start)) {
    const { err, out } = await mkdirOne(parsed, b.shell.cwd, arg);
    if (err) {
      failed = true;
      await b.write('stderr', b.taskErrorToString(err));
    }
    if (out.length > 0) {
      await b.write('stdout', out);
    }
  }
  return failed ? 1 : 0;
}
