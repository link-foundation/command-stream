// Builtin commands framework, ported from Bun's Builtin.rs
// (src/runtime/shell/builtin.rs) with the small builtins (echo, exit, true,
// false, pwd, cd, export, basename, dirname, yes, seq, which). The file
// builtins (ls, mkdir, touch, rm, mv, cat, cp) live in ./builtins/.
//
// A builtin is `async run(b) → exitCode` where `b` is a Builtin:
//   b.kind            builtin name ('echo', ...)
//   b.args            arguments after argv[0] (strings)
//   b.shell           the ShellExecEnv (cwd, exportEnv, ...)
//   b.stdin           {kind: 'fd', reader} | {kind: 'arraybuf', bytes}
//                     | {kind: 'blob', bytes} | {kind: 'ignore'}
//   b.stdout/stderr   {kind: 'fd', writer, captured} | {kind: 'buf', target}
//                     | {kind: 'arraybuf', view, i} | {kind: 'blob'}
//                     | {kind: 'ignore'}
// Output that "needs IO" (an fd) goes through a Writer and may fail
// asynchronously; other outputs are written synchronously (`buf` appends to
// the shell's buffered stdout/stderr, `arraybuf` fills a JS buffer and fails
// with ENOSPC once full, `blob`/`ignore` discard).

import fs from './fs.mjs';
import path from 'node:path';
import { errnoMessage } from './errno.mjs';
import { RedirectFlags } from './lexer.mjs';
import { ShellSysError, sysErrorFromNode, toBytes } from './io.mjs';

const IS_WINDOWS = process.platform === 'win32';

export const USAGE = {
  exit: 'usage: exit [n]\n',
  basename: 'usage: basename string\n',
  dirname: 'usage: dirname string\n',
  cat: 'usage: cat [-belnstuv] [file ...]\n',
  mv: 'usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n',
  rm: 'usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n',
  ls: 'usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n',
  mkdir: 'usage: mkdir [-pv] [-m mode] directory_name ...\n',
  touch:
    'usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n',
  cp: 'usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n',
  seq: 'usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n',
  yes: 'usage: yes [expletive]\n',
};

const BUILTIN_NAMES = [
  'cat',
  'touch',
  'mkdir',
  'export',
  'cd',
  'echo',
  'pwd',
  'which',
  'rm',
  'mv',
  'ls',
  'exit',
  'true',
  'false',
  'yes',
  'seq',
  'dirname',
  'basename',
  'cp',
];
const DISABLED_ON_POSIX = new Set(['cat', 'cp']);

function experimentalBuiltinsEnabled() {
  const v = process.env.BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS;
  return v === '1' || v === 'true';
}

/** Bun's `Kind::from_argv0`: the builtin for a command name, or null. */
export function builtinKind(argv0) {
  if (!BUILTIN_NAMES.includes(argv0)) {
    return null;
  }
  if (
    !IS_WINDOWS &&
    DISABLED_ON_POSIX.has(argv0) &&
    !experimentalBuiltinsEnabled()
  ) {
    return null;
  }
  return argv0;
}

/** open(2) flags for a redirect (Bun's `RedirectFlags::to_flags`). */
export function redirectOpenFlags(redirect) {
  const { O_RDONLY, O_WRONLY, O_CREAT, O_APPEND, O_TRUNC } = fs.constants;
  if (redirect & RedirectFlags.STDIN) {
    return O_RDONLY;
  }
  return (
    O_WRONLY | O_CREAT | (redirect & RedirectFlags.APPEND ? O_APPEND : O_TRUNC)
  );
}

/** Open a redirect target relative to the shell cwd (throws ShellSysError). */
export function openRedirectFile(cwd, file, redirect) {
  if (IS_WINDOWS && file === '/dev/null') {
    return openNulDevice(redirect);
  }
  try {
    return fs.openSync(
      path.resolve(cwd, file),
      redirectOpenFlags(redirect),
      0o666
    );
  } catch (e) {
    throw sysErrorFromNode(e, file);
  }
}

/**
 * Bun maps /dev/null to the NUL device on Windows. It is opened without
 * create/truncate, trying the device namespace path first: Deno reports
 * EISDIR for a bare `NUL` with O_CREAT|O_TRUNC.
 */
function openNulDevice(redirect) {
  // 'r+' is O_RDWR: writable without O_CREAT/O_TRUNC.
  const flags = redirect & RedirectFlags.STDIN ? 'r' : 'r+';
  let firstError;
  for (const target of ['\\\\.\\NUL', 'NUL']) {
    try {
      return fs.openSync(target, flags);
    } catch (e) {
      firstError ??= e;
    }
  }
  throw sysErrorFromNode(firstError, '/dev/null');
}

/** Bun's `bun_sys::is_executable_file_path`. */
export function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) {
      return false;
    }
    if (IS_WINDOWS) {
      return true;
    }
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const WIN_EXTENSIONS = ['exe', 'cmd', 'bat', 'com'];

function whichWindows(pathEnv, cwd, bin) {
  const hasExt = WIN_EXTENSIONS.some((ext) =>
    bin.toLowerCase().endsWith(`.${ext}`)
  );
  const candidates = (base) =>
    hasExt ? [base] : [base, ...WIN_EXTENSIONS.map((e) => `${base}.${e}`)];
  if (/[\\/]/.test(bin) || path.win32.isAbsolute(bin)) {
    // Absolute paths are reported as given, relative ones against the cwd.
    const base = path.win32.isAbsolute(bin)
      ? bin
      : path.win32.resolve(cwd, bin);
    for (const c of candidates(base)) {
      if (isExecutableFile(c)) {
        return c;
      }
    }
    return null;
  }
  // PATH wins over the cwd.
  const dirs = [];
  for (const seg of pathEnv.split(';')) {
    if (seg) {
      dirs.push(path.win32.resolve(cwd, seg));
    }
  }
  if (cwd) {
    dirs.push(cwd);
  }
  for (const dir of dirs) {
    for (const c of candidates(path.win32.join(dir, bin))) {
      if (isExecutableFile(c)) {
        return c;
      }
    }
  }
  return null;
}

function joinWithSep(prefix, part) {
  if (prefix.length === 0) {
    return part;
  }
  return prefix.endsWith('/') ? prefix + part : `${prefix}/${part}`;
}

/**
 * Bun's `which(path, cwd, bin)`: resolve a command name the way the shell
 * does (absolute paths as-is, names with a `/` relative to the cwd without
 * normalization, other names through PATH).
 */
export function which(pathEnv, cwd, bin) {
  if (IS_WINDOWS) {
    return bin ? whichWindows(pathEnv, cwd, bin) : null;
  }
  if (bin.length === 0 || bin.length >= 4096) {
    return null;
  }
  if (path.isAbsolute(bin)) {
    return isExecutableFile(bin) ? bin : null;
  }
  let cwdTrimmed = cwd;
  while (cwdTrimmed.length > 1 && cwdTrimmed.endsWith('/')) {
    cwdTrimmed = cwdTrimmed.slice(0, -1);
  }
  if (bin.includes('/')) {
    if (cwd.length === 0) {
      return null;
    }
    const rel = bin.startsWith('./') ? bin.slice(2) : bin;
    const p = joinWithSep(cwdTrimmed, rel);
    return isExecutableFile(p) ? p : null;
  }
  const cwdForRelative = path.isAbsolute(cwd) ? cwdTrimmed : '';
  for (const segment of pathEnv.split(':')) {
    if (segment.length === 0) {
      continue;
    }
    const prefix = path.isAbsolute(segment)
      ? segment
      : joinWithSep(cwdForRelative, segment);
    const p = joinWithSep(prefix, bin);
    if (isExecutableFile(p)) {
      return p;
    }
  }
  return null;
}

/** Output kinds of a builtin (Bun's `BuiltinIO::from_out_kind`). */
export function builtinOutFromCmdOut(out, target) {
  if (out.kind === 'fd') {
    return { kind: 'fd', writer: out.writer, captured: out.captured };
  }
  if (out.kind === 'pipe') {
    return { kind: 'buf', target };
  }
  return { kind: 'ignore' };
}

export function builtinInFromCmdIn(input) {
  if (input.kind === 'fd') {
    return { kind: 'fd', reader: input.reader };
  }
  return { kind: 'ignore' };
}

export class Builtin {
  constructor({ kind, args, shell, stdin, stdout, stderr }) {
    this.kind = kind;
    this.args = args;
    this.shell = shell;
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
  }

  get cwd() {
    return this.shell.cwd;
  }

  /** Whether `which` ('stdout' | 'stderr') is an fd that needs async IO. */
  needsIO(which) {
    return this[which].kind === 'fd';
  }

  stdinNeedsIO() {
    return this.stdin.kind === 'fd';
  }

  /** Synchronous write to a non-fd output: `{n}` or a ShellSysError. */
  writeNoIO(which, data) {
    const out = this[which];
    const bytes = toBytes(data);
    if (bytes.length === 0) {
      return { n: 0 };
    }
    switch (out.kind) {
      case 'fd':
        throw new Error('writeNoIO called on an fd output');
      case 'buf':
        (out.target === 'stdout'
          ? this.shell.bufferedStdout
          : this.shell.bufferedStderr
        ).append(bytes);
        return { n: bytes.length };
      case 'arraybuf': {
        const total = out.view.length;
        if (out.i >= total) {
          return new ShellSysError('ENOSPC', { syscall: 'write' });
        }
        const n = Math.min(total - out.i, bytes.length);
        out.view.set(bytes.subarray(0, n), out.i);
        out.i += n;
        return { n };
      }
      default:
        return { n: bytes.length };
    }
  }

  /**
   * Write to `which`: through the Writer for fds, synchronously otherwise.
   * Resolves to null on success or a ShellSysError.
   */
  async write(which, data) {
    const out = this[which];
    if (out.kind === 'fd') {
      return await out.writer.write(data, out.captured);
    }
    const r = this.writeNoIO(which, data);
    return r instanceof ShellSysError ? r : null;
  }

  /** Stdin bytes of a JS buffer/blob input (empty for fds and ignore). */
  readStdinNoIO() {
    if (this.stdin.kind === 'arraybuf' || this.stdin.kind === 'blob') {
      return Buffer.from(this.stdin.bytes);
    }
    return Buffer.alloc(0);
  }

  /** "{kind}: {msg}" (Bun's `fmt_error_arena` with a kind). */
  fmtErr(msg, kind = this.kind) {
    return `${kind}: ${msg}`;
  }

  /** Bun's `shell_err_to_string`. */
  shellErrToString(err) {
    if (err instanceof ShellSysError) {
      return err.path
        ? this.fmtErr(`${err.message}: ${err.path}\n`)
        : this.fmtErr(`${err.message}\n`);
    }
    return this.fmtErr(`${err.message}\n`);
  }

  /** Bun's `task_error_to_string` for a (Node or shell) system error. */
  taskErrorToString(err) {
    const code = err?.code;
    const message = typeof code === 'string' ? errnoMessage(code) : null;
    if (message !== null) {
      return err.path
        ? this.fmtErr(`${err.path}: ${message}\n`)
        : this.fmtErr(`${message}\n`);
    }
    return this.fmtErr(`unknown error ${Math.abs(err?.errno ?? 0)}\n`);
  }

  /** Write an error message to stderr and finish with `exitCode`. */
  async writeFailingError(msg, exitCode) {
    await this.write('stderr', msg);
    return exitCode;
  }

  /**
   * Bun's `fail_parse`: `{type: 'illegal', opt}`, `{type: 'usage'}` or
   * `{type: 'unsupported', opt}`.
   */
  failParse(err) {
    let msg;
    if (err.type === 'illegal') {
      msg = this.fmtErr(`illegal option -- ${err.opt}\n`);
    } else if (err.type === 'unsupported') {
      msg = this.fmtErr(
        `unsupported option, please open a GitHub issue -- ${err.opt}\n`
      );
    } else {
      msg = USAGE[this.kind];
    }
    return this.writeFailingError(msg, 1);
  }
}

// --- small builtins --------------------------------------------------------

function trimSubsequentLeadingChars(s, ch) {
  if (s.length === 0) {
    return s;
  }
  let end = s.length - 1;
  let endend = s.length;
  while (end > 0 && s[end] === ch) {
    endend = end + 1;
    end--;
  }
  return s.slice(0, endend);
}

const HEX = /^[0-9a-fA-F]$/;

/** Append `input` with echo -e escapes; returns true on `\c`. */
function appendWithEscapes(out, input) {
  let i = 0;
  const simple = {
    0x5c: 0x5c,
    0x61: 0x07,
    0x62: 0x08,
    0x65: 0x1b,
    0x45: 0x1b,
    0x66: 0x0c,
    0x6e: 0x0a,
    0x72: 0x0d,
    0x74: 0x09,
    0x76: 0x0b,
  };
  while (i < input.length) {
    if (input[i] !== 0x5c || i + 1 >= input.length) {
      out.push(input[i]);
      i++;
      continue;
    }
    const c = input[i + 1];
    if (Object.hasOwn(simple, c)) {
      out.push(simple[c]);
      i += 2;
    } else if (c === 0x63) {
      return true;
    } else if (c === 0x30) {
      i += 2;
      let val = 0;
      for (
        let digits = 0;
        digits < 3 && i < input.length && input[i] >= 0x30 && input[i] <= 0x37;
        digits++
      ) {
        val = (val * 8 + (input[i] - 0x30)) & 0xff;
        i++;
      }
      out.push(val);
    } else if (c === 0x78) {
      i += 2;
      let n = 0;
      let val = 0;
      while (
        n < 2 &&
        i < input.length &&
        HEX.test(String.fromCharCode(input[i]))
      ) {
        val = val * 16 + parseInt(String.fromCharCode(input[i]), 16);
        i++;
        n++;
      }
      if (n > 0) {
        out.push(val);
      } else {
        out.push(0x5c, 0x78);
      }
    } else {
      out.push(0x5c, c);
      i += 2;
    }
  }
  return false;
}

async function echo(b) {
  const args = b.args;
  let noNewline = false;
  let escapes = false;
  let start = 0;
  for (const flag of args) {
    if (flag.length < 2 || flag[0] !== '-' || !/^[neE]+$/.test(flag.slice(1))) {
      break;
    }
    for (const c of flag.slice(1)) {
      if (c === 'n') {
        noNewline = true;
      } else {
        escapes = c === 'e';
      }
    }
    start++;
  }
  const out = [];
  const pushStr = (s) => {
    for (const byte of Buffer.from(s, 'utf8')) {
      out.push(byte);
    }
  };
  let hasTrailingNewline = false;
  let stop = false;
  for (let i = start; i < args.length && !stop; i++) {
    const arg = args[i];
    const isLast = i === args.length - 1;
    if (escapes) {
      stop = appendWithEscapes(out, Buffer.from(arg, 'utf8'));
    } else if (isLast) {
      hasTrailingNewline = arg.endsWith('\n');
      pushStr(trimSubsequentLeadingChars(arg, '\n'));
    } else {
      pushStr(arg);
    }
    if (!stop && !isLast) {
      out.push(0x20);
    }
  }
  if (!stop && !hasTrailingNewline && !noNewline) {
    out.push(0x0a);
  }
  const err = await b.write('stdout', Buffer.from(out));
  return err && b.needsIO('stdout') ? err.errno : 0;
}

function exit(b) {
  if (b.args.length === 0) {
    return 0;
  }
  if (b.args.length > 1) {
    return b.writeFailingError('exit: too many arguments\n', 1);
  }
  const m = /^\+?([0-9]+)$/.exec(b.args[0]);
  const n = m ? BigInt(m[1]) : null;
  if (n === null || n > 0xffffffffffffffffn) {
    return b.writeFailingError('exit: numeric argument required\n', 1);
  }
  return Number(n % 256n);
}

async function pwd(b) {
  if (b.args.length > 0) {
    return b.writeFailingError('pwd: too many arguments\n', 1);
  }
  const err = await b.write('stdout', `${b.shell.cwd}\n`);
  return err ? 1 : 0;
}

function cd(b) {
  const fail = (msg) => b.writeFailingError(b.fmtErr(msg), 1);
  if (b.args.length > 1) {
    return fail('too many arguments\n');
  }
  let target;
  try {
    if (b.args.length === 0) {
      target = b.shell.getHomedir();
      if (target.length === 0) {
        return fail('HOME not set\n');
      }
      b.shell.changeCwd(target);
    } else if (b.args[0] === '-') {
      target = b.shell.prevCwd;
      b.shell.changePrevCwd();
    } else {
      target = b.args[0];
      b.shell.changeCwd(target);
    }
  } catch (e) {
    if (e?.code === 'ENOTDIR' || e?.code === 'ENOENT') {
      return fail(`not a directory: ${target}\n`);
    }
    if (e?.code === 'ENAMETOOLONG') {
      return fail('file name too long\n');
    }
    const msg = errnoMessage(e?.code) ?? e?.code ?? String(e);
    return fail(`${msg}: ${target}\n`);
  }
  return 0;
}

async function exportBuiltin(b) {
  if (b.args.length === 0) {
    const entries = [...b.shell.exportEnv.entries()].sort(([a], [c]) =>
      Buffer.compare(Buffer.from(a), Buffer.from(c))
    );
    const out = entries.map(([k, v]) => `${k}=${v}\n`).join('');
    const err = await b.write('stdout', out);
    return err ? 1 : 0;
  }
  for (const arg of b.args) {
    if (arg.length === 0) {
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq === -1) {
      b.shell.exportEnv.set(arg, '');
    } else {
      b.shell.exportEnv.set(arg.slice(0, eq), arg.slice(eq + 1));
    }
  }
  return 0;
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

/** Bun's `resolve_path::dirname::<Posix>`. */
function dirnamePosix(p) {
  const sep = p.lastIndexOf('/');
  if (sep === -1) {
    return '';
  }
  if (sep === 0) {
    return '/';
  }
  if (sep === p.length - 1) {
    return dirnamePosix(p.slice(0, -1));
  }
  return p.slice(0, sep);
}

function makePathBuiltin(fn) {
  return async (b) => {
    if (b.args.length === 0) {
      return b.writeFailingError(USAGE[b.kind], 1);
    }
    const out = b.args.map((arg) => `${fn(arg)}\n`).join('');
    const err = await b.write('stdout', out);
    return err ? 1 : 0;
  };
}

const basename = makePathBuiltin(basenameAny);
const dirname = makePathBuiltin((p) => dirnamePosix(p) || '.');

async function yes(b) {
  const line = b.args.length === 0 ? 'y\n' : `${b.args.join(' ')}\n`;
  const lineBytes = Buffer.from(line, 'utf8');
  const target = lineBytes.length > 4096 ? lineBytes.length : 8192;
  const copies = Math.max(1, Math.floor(target / lineBytes.length));
  const chunk = Buffer.concat(Array(copies).fill(lineBytes));
  if (b.needsIO('stdout')) {
    for (;;) {
      const err = await b.write('stdout', chunk);
      if (err) {
        return 1;
      }
    }
  }
  for (;;) {
    for (let i = 0; i < 4; i++) {
      const r = b.writeNoIO('stdout', chunk);
      if (r instanceof ShellSysError) {
        return b.writeFailingError(b.fmtErr(`${r.code}\n`), 1);
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const F32_RE = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/;

/** Rust's `f32::from_str` (null when invalid). */
export function parseF32(s) {
  if (/^[+-]?(inf|infinity|nan)$/i.test(s)) {
    return s.toLowerCase().includes('nan') ? NaN : Infinity;
  }
  if (!F32_RE.test(s)) {
    return null;
  }
  return Math.fround(Number(s));
}

/** Rust's `Display` for f32: shortest round-trip digits, no exponent. */
export function formatF32(x) {
  if (Object.is(x, -0)) {
    return '-0';
  }
  if (x === 0) {
    return '0';
  }
  let exp;
  for (let p = 1; p <= 9; p++) {
    exp = x.toExponential(p - 1);
    if (Math.fround(Number(exp)) === x) {
      break;
    }
  }
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(exp);
  const sign = m[1];
  const digits = m[2] + (m[3] ?? '');
  const e = Number(m[4]);
  let out;
  if (e >= digits.length - 1) {
    out = digits + '0'.repeat(e - digits.length + 1);
  } else if (e >= 0) {
    out = `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
  } else {
    out = `0.${'0'.repeat(-e - 1)}${digits}`;
  }
  return sign + out;
}

async function seq(b) {
  const args = b.args;
  const fail = (msg) => b.writeFailingError(msg, 1);
  if (args.length === 0) {
    return fail(USAGE.seq);
  }
  let separator = '\n';
  let terminator = '';
  let idx = 0;
  while (idx < args.length) {
    const arg = args[idx];
    if (arg === '-s' || arg === '--separator') {
      if (++idx >= args.length) {
        return fail('seq: option requires an argument -- s\n');
      }
      separator = args[idx++];
    } else if (arg.startsWith('-s') && arg.length > 2) {
      separator = arg.slice(2);
      idx++;
    } else if (arg === '-t' || arg === '--terminator') {
      if (++idx >= args.length) {
        return fail('seq: option requires an argument -- t\n');
      }
      terminator = args[idx++];
    } else if (arg.startsWith('-t') && arg.length > 2) {
      terminator = arg.slice(2);
      idx++;
    } else if (arg === '-w' || arg === '--fixed-width') {
      idx++;
    } else {
      break;
    }
  }
  if (idx >= args.length) {
    return fail(USAGE.seq);
  }
  const nums = [];
  for (let i = idx; i < args.length && nums.length < 3; i++) {
    const n = parseF32(args[i]);
    if (n === null || !Number.isFinite(n)) {
      return fail('seq: invalid argument\n');
    }
    nums.push(n);
  }
  let start = 1;
  let end = nums[0];
  let incr = start > end ? -1 : 1;
  if (nums.length >= 2) {
    start = nums[0];
    end = nums[1];
    if (start < end) {
      incr = 1;
    } else if (start > end) {
      incr = -1;
    }
  }
  if (nums.length === 3) {
    [start, incr, end] = nums;
    if (incr === 0) {
      return fail('seq: zero increment\n');
    }
    if (start > end && incr > 0) {
      return fail('seq: needs negative decrement\n');
    }
    if (start < end && incr < 0) {
      return fail('seq: needs positive increment\n');
    }
  }
  const parts = [];
  let current = start;
  while (incr > 0 ? current <= end : current >= end) {
    parts.push(formatF32(current), separator);
    const next = Math.fround(current + incr);
    if (next === current) {
      break;
    }
    current = next;
  }
  parts.push(terminator);
  const err = await b.write('stdout', parts.join(''));
  return err && b.needsIO('stdout') ? 1 : 0;
}

async function whichBuiltin(b) {
  if (b.args.length === 0) {
    await b.write('stdout', '\n');
    return 1;
  }
  const pathEnv = b.shell.exportEnv.get('PATH') ?? '';
  let hadNotFound = false;
  const io = b.needsIO('stdout');
  for (const arg of b.args) {
    const resolved = which(pathEnv, b.shell.cwd, arg);
    let line;
    if (resolved === null) {
      hadNotFound = true;
      line = io ? `${arg} not found\n` : b.fmtErr(`${arg} not found\n`);
    } else {
      line = `${resolved}\n`;
    }
    const err = await b.write('stdout', line);
    if (err && io) {
      return err.errno;
    }
  }
  return hadNotFound ? 1 : 0;
}

export const SMALL_BUILTINS = {
  echo,
  exit,
  true: () => 0,
  false: () => 1,
  pwd,
  cd,
  export: exportBuiltin,
  basename,
  dirname,
  yes,
  seq,
  which: whichBuiltin,
};
