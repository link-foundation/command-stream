// The `touch` builtin, ported from Bun's builtin/touch.rs (src/runtime/shell/).
//
// Bun touches every operand in its own thread-pool task and writes each
// task's error as the task completes; this port runs the operands one at a
// time, in argument order. Every operand (absolute or joined onto the cwd) is
// normalized, keeping a trailing slash, and errors report that path. No
// option is supported: an existing path gets its atime and mtime set to the
// current time (millisecond precision), a missing one is created (0664 before
// the umask) without touching its times.

import fs from 'node:fs';
import path from 'node:path';
import { sysErrorFromNode } from '../io.mjs';

const UNSUPPORTED_LONG = {
  '--no-create': '--no-create',
  '--date': '--date',
  '--reference': '--reference=FILE',
  // Bun reports --time with the --reference text.
  '--time': '--reference=FILE',
};
const UNSUPPORTED_SHORT = new Set('acdhmrt');

/**
 * Bun's `parse_flags` with touch's options: `{start}`, `{usage: true}`,
 * `{illegal: bytes}` or `{unsupported: opt}`.
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
    if (
      arg.length > 2 &&
      arg[1] === '-' &&
      Object.hasOwn(UNSUPPORTED_LONG, arg)
    ) {
      return { unsupported: UNSUPPORTED_LONG[arg] };
    }
    // Every short flag stops parsing, so only the first one matters.
    const small = Buffer.from(arg.slice(1), 'utf8');
    const ch = String.fromCharCode(small[0]);
    if (UNSUPPORTED_SHORT.has(ch)) {
      return { unsupported: `-${ch}` };
    }
    return { illegal: small.subarray(1) };
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

/** One ShellTouchTask: a ShellSysError or null. */
async function touchOne(cwd, arg) {
  const filepath = path.isAbsolute(arg)
    ? path.normalize(arg)
    : path.join(cwd, arg);
  // Bun sets both times to the same millisecond timestamp.
  const now = new Date(Date.now());
  try {
    await fs.promises.utimes(filepath, now, now);
    return null;
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      return sysErrorFromNode(e, filepath);
    }
  }
  try {
    const { O_CREAT, O_WRONLY } = fs.constants;
    const fh = await fs.promises.open(filepath, O_CREAT | O_WRONLY, 0o664);
    await fh.close();
    return null;
  } catch (e) {
    return sysErrorFromNode(e, filepath);
  }
}

export async function touch(b) {
  const parsed = parseOpts(b.args);
  if (parsed.start === undefined) {
    return failOpts(b, parsed);
  }
  let failed = false;
  for (const arg of b.args.slice(parsed.start)) {
    const err = await touchOne(b.shell.cwd, arg);
    if (err) {
      failed = true;
      await b.write('stderr', b.taskErrorToString(err));
    }
  }
  return failed ? 1 : 0;
}
