// The `ls` builtin, ported from Bun's builtin/ls.rs (src/runtime/shell/).
//
// Bun lists every operand (and, with -R, every subdirectory) in its own
// thread-pool task and writes each task's output (its error to stderr first,
// then its listing to stdout) as the task completes, so the order of the
// sections is nondeterministic. This port runs the tasks one at a time from a
// FIFO queue: operands in argument order, subdirectories breadth-first in
// readdir order (the most common order Bun produces for small trees).
// Entries within a directory are in readdir order (unsorted), like Bun.

import fs from '../fs.mjs';
import path from 'node:path';
import { sysErrorFromNode } from '../io.mjs';

const IS_WINDOWS = process.platform === 'win32';
const SEP = IS_WINDOWS ? '\\' : '/';
const IGNORED_FLAGS = new Set('r1bBcCDfFgGhHiIkLmnNoOpqQsStTuUvwxXZ');
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const SIX_MONTHS_SECS = 180 * 24 * 60 * 60;
const LONG_UNKNOWN = '?????????? ? ? ? ?            ? ';

/**
 * Bun's `fs.Dir` yields bare Buffers instead of Dirents for
 * `encoding: 'buffer'`; wrap them and take the type from lstat.
 */
function direntOf(entry, dirPath) {
  if (!(entry instanceof Uint8Array)) {
    return entry;
  }
  const name = Buffer.from(entry);
  const full = Buffer.concat([Buffer.from(dirPath), Buffer.from(SEP), name]);
  return {
    name,
    isDirectory() {
      try {
        return fs.lstatSync(full).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

/** Parse flags: `{opts, start}` (start = first operand or null) or `{illegal}`. */
function parseOpts(args) {
  const opts = {
    dotfiles: 'hide',
    listDirectories: false,
    longListing: false,
    recursive: false,
  };
  for (let idx = 0; idx < args.length; idx++) {
    const flag = Buffer.from(args[idx], 'utf8');
    if (flag.length === 0 || flag[0] !== 0x2d) {
      return { opts, start: idx };
    }
    if (flag.length === 1) {
      return { illegal: '-' };
    }
    for (const byte of flag.subarray(1)) {
      const ch = String.fromCharCode(byte);
      if (ch === 'a') {
        opts.dotfiles = 'all';
      } else if (ch === 'A') {
        opts.dotfiles = 'almostAll';
      } else if (ch === 'd') {
        opts.listDirectories = true;
      } else if (ch === 'l') {
        opts.longListing = true;
      } else if (ch === 'R') {
        opts.recursive = true;
      } else if (!(byte < 0x80 && IGNORED_FLAGS.has(ch))) {
        // Bun reports the first character of the flag word (lossy UTF-8).
        return { illegal: flag.subarray(1, 2).toString('utf8') };
      }
    }
  }
  return { opts, start: null };
}

function fileTypeChar(mode) {
  const { S_IFMT, S_IFDIR, S_IFLNK, S_IFBLK, S_IFCHR, S_IFIFO, S_IFSOCK } =
    fs.constants;
  switch (mode & S_IFMT) {
    case S_IFDIR:
      return 'd';
    case S_IFLNK:
      return 'l';
    case S_IFBLK:
      return 'b';
    case S_IFCHR:
      return 'c';
    case S_IFIFO:
      return 'p';
    case S_IFSOCK:
      return 's';
    default:
      return '-';
  }
}

function formatPermissions(mode) {
  const bit = (mask, ch) => (mode & mask ? ch : '-');
  const special = (exec, flag, set, unset) => {
    if (mode & flag) {
      return mode & exec ? set : unset;
    }
    return mode & exec ? 'x' : '-';
  };
  return (
    bit(0o400, 'r') +
    bit(0o200, 'w') +
    special(0o100, 0o4000, 's', 'S') +
    bit(0o040, 'r') +
    bit(0o020, 'w') +
    special(0o010, 0o2000, 's', 'S') +
    bit(0o004, 'r') +
    bit(0o002, 'w') +
    special(0o001, 0o1000, 't', 'T')
  );
}

const pad2 = (n) => String(n).padStart(2, '0');

/** "Mon DD HH:MM" within six months of now, "Mon DD  YYYY" otherwise (UTC). */
function formatTime(timestamp, nowSecs) {
  const secs = Math.max(0, timestamp);
  const d = new Date(secs * 1000);
  const head = `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())}`;
  const recent =
    secs > Math.max(0, nowSecs - SIX_MONTHS_SECS) &&
    secs <= nowSecs + SIX_MONTHS_SECS;
  if (recent) {
    return `${head} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  return `${head}  ${String(d.getUTCFullYear()).padStart(4)}`.slice(0, 12);
}

class LsTask {
  constructor(ls, taskPath, printDirectory) {
    this.ls = ls;
    this.opts = ls.opts;
    this.path = taskPath;
    this.printDirectory = printDirectory;
    this.output = [];
    this.err = null;
  }

  /** Absolute fs path for a task-relative path (Bun's `*at(cwd, path)`). */
  fsPath(p) {
    if (p.length === 0) {
      return p;
    }
    if (IS_WINDOWS) {
      return path.resolve(this.ls.cwd, p.toString('utf8'));
    }
    if (p[0] === 0x2f) {
      return p;
    }
    return Buffer.concat([Buffer.from(`${this.ls.cwd}/`), p]);
  }

  errorWithPath(e) {
    return sysErrorFromNode(e, this.path.toString('utf8'));
  }

  join(child) {
    const parent = this.path;
    const last = parent.length > 0 ? String.fromCharCode(parent.at(-1)) : '';
    const needsSep = last !== '' && last !== '/' && last !== SEP;
    return Buffer.concat(
      needsSep ? [parent, Buffer.from(SEP), child] : [parent, child]
    );
  }

  run() {
    if (this.opts.longListing) {
      this.nowSecs = Math.floor(Date.now() / 1000);
    }
    const dirPath = this.fsPath(this.path);
    let dir;
    let entry;
    try {
      dir = fs.opendirSync(dirPath, { encoding: 'buffer' });
      // Bun's fs.Dir defers open errors (EACCES) to the first read.
      entry = dir.readSync();
    } catch (e) {
      dir?.closeSync();
      this.listNonDirectoryOperand(e);
      return;
    }
    try {
      if (this.opts.listDirectories) {
        this.output.push(this.path, Buffer.from('\n'));
        return;
      }
      if (this.printDirectory) {
        this.output.push(this.path, Buffer.from(':\n'));
      }
      this.addEntry(Buffer.from('.'), dirPath);
      this.addEntry(Buffer.from('..'), dirPath);
      while (entry !== null) {
        entry = direntOf(entry, dirPath);
        this.addEntry(entry.name, dirPath);
        if (entry.isDirectory() && this.opts.recursive) {
          this.ls.queue.push(new LsTask(this.ls, this.join(entry.name), true));
        }
        try {
          entry = dir.readSync();
        } catch (e) {
          this.err = this.errorWithPath(e);
          return;
        }
      }
    } finally {
      dir.closeSync();
    }
  }

  listNonDirectoryOperand(openErr) {
    const p = this.fsPath(this.path);
    try {
      if (fs.statSync(p).isDirectory()) {
        this.err = this.errorWithPath(openErr);
        return;
      }
    } catch (e) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ELOOP') {
        this.err = this.errorWithPath(e);
        return;
      }
    }
    let st;
    try {
      st = fs.lstatSync(p, { bigint: true });
    } catch (e) {
      this.err = this.errorWithPath(e);
      return;
    }
    if (this.opts.longListing) {
      this.addEntryLongFromStat(this.path, st);
    } else {
      this.output.push(this.path, Buffer.from('\n'));
    }
  }

  addEntry(name, dirPath) {
    const { dotfiles } = this.opts;
    const isDotDir = name.equals(DOT) || name.equals(DOTDOT);
    if (
      (dotfiles === 'almostAll' && isDotDir) ||
      (dotfiles === 'hide' && name[0] === 0x2e)
    ) {
      return;
    }
    if (!this.opts.longListing) {
      this.output.push(name, Buffer.from('\n'));
      return;
    }
    const entryPath = IS_WINDOWS
      ? path.join(dirPath, name.toString('utf8'))
      : Buffer.concat([Buffer.from(dirPath), Buffer.from('/'), name]);
    let st;
    try {
      st = fs.lstatSync(entryPath, { bigint: true });
    } catch {
      this.output.push(Buffer.from(LONG_UNKNOWN), name, Buffer.from('\n'));
      return;
    }
    this.addEntryLongFromStat(name, st);
  }

  addEntryLongFromStat(name, st) {
    const mode = Number(st.mode);
    const mtime = Number(st.mtimeNs / 1_000_000_000n);
    const line =
      `${fileTypeChar(mode)}${formatPermissions(mode)} ` +
      `${String(st.nlink).padStart(3)} ${String(st.uid).padStart(5)} ` +
      `${String(st.gid).padStart(5)} ${String(st.size).padStart(8)} ` +
      `${formatTime(mtime, this.nowSecs)} `;
    this.output.push(Buffer.from(line), name, Buffer.from('\n'));
  }
}

const DOT = Buffer.from('.');
const DOTDOT = Buffer.from('..');

export async function ls(b) {
  const parsed = parseOpts(b.args);
  if (parsed.illegal !== undefined) {
    return b.writeFailingError(
      b.fmtErr(`illegal option -- ${parsed.illegal}\n`),
      1
    );
  }
  const state = { opts: parsed.opts, cwd: b.shell.cwd, queue: [] };
  if (parsed.start === null) {
    state.queue.push(new LsTask(state, Buffer.from('.'), false));
  } else {
    const operands = b.args.slice(parsed.start);
    for (const operand of operands) {
      const p = Buffer.from(operand, 'utf8');
      state.queue.push(new LsTask(state, p, operands.length > 1));
    }
  }
  let failed = false;
  for (let i = 0; i < state.queue.length; i++) {
    const task = state.queue[i];
    state.queue[i] = null;
    task.run();
    // Write errors are ignored, like Bun's OutputTask.
    if (task.err) {
      failed = true;
      await b.write('stderr', b.taskErrorToString(task.err));
    }
    await b.write('stdout', Buffer.concat(task.output));
  }
  return failed ? 1 : 0;
}
