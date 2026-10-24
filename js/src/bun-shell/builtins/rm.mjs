// The `rm` builtin, ported from Bun's builtin/rm.rs (src/runtime/shell/).
//
// Bun removes every operand in its own task on a thread pool, and every
// directory of a recursive removal in its own sub-task. This port runs the
// same state machine single-threaded: operands one after another, and the
// directory tasks of one operand through a FIFO queue. That reproduces Bun's
// output in the common cases (its order for large trees depends on thread
// timing): a directory's `-v` lines (its files, then itself) are written once
// all of its subdirectories are done, and an error in one task stops the
// work of the tasks that run after it (Bun shares the error signal).

import fs from '../fs.mjs';
import path from 'node:path';
import { USAGE } from '../builtin.mjs';
import { ShellSysError, sysErrorFromNode } from '../io.mjs';

const IS_WINDOWS = process.platform === 'win32';
// Platforms where unlink(2) on a directory fails with EPERM (not EISDIR).
const UNLINK_DIR_EPERM = new Set([
  'darwin',
  'freebsd',
  'netbsd',
  'openbsd',
  'sunos',
  'aix',
  'win32',
]).has(process.platform);

const NOT_SUPPORTED_I = 'rm: "-i" is not supported yet';

/** Bun's `Rm::parse_flag`: 'continue' | 'done' | 'illegal' | 'illegal-flag'. */
function parseFlag(opts, flag) {
  if (flag.length === 0 || flag[0] !== '-') {
    return 'done';
  }
  if (flag.length > 2 && flag[1] === '-') {
    switch (flag) {
      case '--preserve-root':
      case '--no-preserve-root':
        return 'continue';
      case '--recursive':
        opts.recursive = true;
        return 'continue';
      case '--verbose':
        opts.verbose = true;
        return 'continue';
      case '--dir':
        opts.removeEmptyDirs = true;
        return 'continue';
      case '--interactive=never':
      case '--interactive=once':
      case '--interactive=always':
        opts.prompt = flag.slice('--interactive='.length);
        return 'continue';
      default:
        return 'illegal';
    }
  }
  for (const ch of flag.slice(1)) {
    if (ch === 'f') {
      opts.force = true;
      opts.prompt = 'never';
    } else if (ch === 'r' || ch === 'R') {
      opts.recursive = true;
    } else if (ch === 'v') {
      opts.verbose = true;
    } else if (ch === 'd') {
      opts.removeEmptyDirs = true;
    } else if (ch === 'i') {
      opts.prompt = 'once';
    } else if (ch === 'I') {
      opts.prompt = 'always';
    } else {
      return 'illegal-flag';
    }
  }
  return 'continue';
}

/** Bun's `resolve_path::join` (Node's path.normalize of the joined parts). */
function bunJoin(parts) {
  const joined = parts.filter((p) => p.length > 0).join('/');
  return joined.length === 0 ? '.' : path.posix.normalize(joined);
}

/**
 * Bun's `resolve_path::joinZ` for an absolute subdirectory. On Windows it
 * normalizes with the native separator (`C:\t\dir\sub`).
 */
function dirJoin(parent, name) {
  return IS_WINDOWS
    ? path.win32.normalize(`${parent}\\${name}`)
    : bunJoin([parent, name]);
}

/**
 * The path of a file inside `dir`. Bun on Windows appends it with `/` without
 * normalizing (`C:\t\dir\sub/file.txt`).
 */
function fileJoin(dir, name) {
  return IS_WINDOWS ? concatJoin(dir, name) : bunJoin([dir, name]);
}

/** `ShellRmTask::join` for relative paths: plain concatenation. */
function concatJoin(parent, name) {
  const sep = parent.endsWith('/') || (IS_WINDOWS && parent.endsWith('\\'));
  const isSep = name[0] === '/' || (IS_WINDOWS && name[0] === '\\');
  return (sep ? parent : `${parent}/`) + (isSep ? name.slice(1) : name);
}

/**
 * Bun's preserve-root check: an operand whose normalized absolute path has
 * no dirname (the root or a top-level entry) may not be removed. Returns
 * the path to report, or null.
 */
function refusedPath(cwd, arg) {
  const p = IS_WINDOWS ? path.win32 : path.posix;
  const resolved = p.isAbsolute(arg) ? arg : bunJoin([cwd, arg]);
  const normalized = p.normalize(resolved);
  const parts = normalized.split(IS_WINDOWS ? /[\\/]/ : '/').filter(Boolean);
  if (IS_WINDOWS) {
    return parts.length <= 2 ? resolved : null;
  }
  return parts.length <= 1 ? resolved : null;
}

class DirTask {
  constructor(parent, taskPath, kindHint) {
    this.parent = parent;
    this.path = taskPath;
    this.kindHint = kindHint;
    this.isAbsolute = false;
    this.subtaskCount = 1;
    this.needToWait = false;
    this.deleted = [];
  }
}

/** One operand (Bun's `ShellRmTask`). */
class RmTask {
  constructor(exec, root) {
    this.exec = exec;
    this.opts = exec.opts;
    this.cwd = exec.cwd;
    this.err = null;
    this.queue = [new DirTask(null, root, 'idk')];
    this.done = false;
  }

  get errorSignal() {
    return this.exec.errorSignal;
  }

  run() {
    while (this.queue.length > 0) {
      this.runDirTask(this.queue.shift());
    }
  }

  // --- syscalls relative to the shell cwd ---

  abs(p) {
    if (p.length === 0 || path.isAbsolute(p)) {
      return p;
    }
    return this.cwd.endsWith('/') ? this.cwd + p : `${this.cwd}/${p}`;
  }

  sys(fn, p) {
    try {
      return fn(this.abs(p));
    } catch (e) {
      throw typeof e?.errno === 'number'
        ? sysErrorFromNode(e, p)
        : new ShellSysError('EINVAL', { path: p });
    }
  }

  unlink(p) {
    this.sys(fs.unlinkSync, p);
  }

  rmdir(p) {
    try {
      this.sys(fs.rmdirSync, p);
    } catch (e) {
      // Bun calls rmdirat(cwd_fd, p): a bare '.'/'..' fails with EINVAL /
      // ENOTEMPTY even after the cwd itself was removed (ENOENT by path).
      const last = e.code === 'ENOENT' ? p.replace(/\/+$/, '') : '';
      if (last === '.' || last === '..') {
        const code = last === '.' ? 'EINVAL' : 'ENOTEMPTY';
        throw new ShellSysError(code, { path: p });
      }
      throw e;
    }
  }

  openDir(p) {
    const { O_DIRECTORY, O_RDONLY, O_NOFOLLOW } = fs.constants;
    const flags = IS_WINDOWS ? O_RDONLY : O_DIRECTORY | O_RDONLY | O_NOFOLLOW;
    if (!IS_WINDOWS) {
      fs.closeSync(this.sys((a) => fs.openSync(a, flags), p));
    }
    return this.sys(fs.opendirSync, p);
  }

  // --- task bookkeeping ---

  verboseDeleted(task, p) {
    if (this.opts.verbose) {
      task.deleted.push(`${p}\n`);
    }
  }

  handleErr(err) {
    if (this.err === null) {
      this.err = err;
      this.exec.errorSignal = true;
    }
  }

  enqueue(parent, name, isAbsolute, kindHint) {
    if (this.errorSignal) {
      return;
    }
    const p = isAbsolute
      ? dirJoin(parent.path, name)
      : concatJoin(parent.path, name);
    this.enqueueNoJoin(parent, p, kindHint);
  }

  enqueueNoJoin(parent, p, kindHint) {
    if (this.errorSignal) {
      return;
    }
    parent.subtaskCount++;
    this.queue.push(new DirTask(parent, p, kindHint));
  }

  runDirTask(task) {
    task.isAbsolute = path.isAbsolute(task.path);
    let waiting = false;
    try {
      waiting = this.removeEntry(task, task.isAbsolute);
    } catch (e) {
      this.handleErr(e);
    }
    if (!waiting) {
      this.postRun(task);
    }
  }

  postRun(task) {
    if (task.needToWait) {
      return;
    }
    if (--task.subtaskCount !== 0) {
      return;
    }
    if (this.opts.verbose && task.deleted.length > 0) {
      this.exec.verboseOut.push(task.deleted.join(''));
      task.deleted = [];
    }
    const parent = task.parent;
    if (parent === null) {
      this.done = true;
      return;
    }
    if (--parent.subtaskCount === 0) {
      this.deleteAfterWaitingForChildren(parent);
    }
  }

  deleteAfterWaitingForChildren(task) {
    task.needToWait = false;
    task.subtaskCount = 1;
    let doPostRun = true;
    if (!this.errorSignal) {
      try {
        doPostRun = this.removeEntryDirAfterChildren(task);
      } catch (e) {
        this.handleErr(e);
      }
    }
    if (doPostRun) {
      this.postRun(task);
    }
  }

  // --- removal ---

  /** Returns whether the task waits for subtasks. */
  removeEntry(task, isAbsolute) {
    const wait = { value: false };
    if (task.kindHint === 'dir') {
      this.removeEntryDir(task, isAbsolute, wait);
    } else {
      const onDir = () => this.removeEntryDir(task, isAbsolute, wait);
      this.removeEntryFile(task, task.path, isAbsolute, {
        onIsDir: onDir,
        onDirNotEmpty: onDir,
      });
    }
    return wait.value;
  }

  removeEntryFile(parent, p, isAbsolute, handler) {
    try {
      this.unlink(p);
    } catch (e) {
      if (e.code === 'ENOENT' && this.opts.force) {
        this.verboseDeleted(parent, p);
        return;
      }
      if (e.code === 'EISDIR') {
        handler.onIsDir(parent, p, isAbsolute);
        return;
      }
      if (e.code === 'EPERM' && UNLINK_DIR_EPERM) {
        this.removeEntryFileEperm(parent, p, isAbsolute, handler, e);
        return;
      }
      throw e;
    }
    this.verboseDeleted(parent, p);
  }

  removeEntryFileEperm(parent, p, isAbsolute, handler, err) {
    if (!this.opts.recursive && !this.opts.removeEmptyDirs) {
      handler.onIsDir(parent, p, isAbsolute);
      return;
    }
    try {
      this.rmdir(p);
    } catch (e2) {
      if (e2.code === 'ENOTEMPTY') {
        handler.onDirNotEmpty(parent, p, isAbsolute);
        return;
      }
      throw e2.code === 'ENOTDIR' ? err : e2;
    }
    this.verboseDeleted(parent, p);
  }

  /** `-d` without `-r`: rmdir(2); returns whether the entry was handled. */
  removeEmptyDir(task, isAbsolute) {
    const p = task.path;
    try {
      this.rmdir(p);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT' && this.opts.force) {
        this.verboseDeleted(task, p);
        return true;
      }
      if (e.code !== 'ENOTDIR') {
        throw e;
      }
    }
    const state = { treatAsDir: false, allowEnqueue: false, enqueued: false };
    this.removeEntryFile(task, p, isAbsolute, this.parentHandler(state));
    return !state.treatAsDir;
  }

  removeEntryDir(task, isAbsolute, wait) {
    const p = task.path;
    if (this.opts.removeEmptyDirs && !this.opts.recursive) {
      if (this.removeEmptyDir(task, isAbsolute)) {
        return;
      }
    }
    if (!this.opts.recursive) {
      throw new ShellSysError('EISDIR', { path: p });
    }
    let dir;
    try {
      dir = this.openDir(p);
    } catch (e) {
      if (e.code === 'ENOENT' && this.opts.force) {
        this.verboseDeleted(task, p);
        return;
      }
      if (e.code === 'ENOTDIR') {
        const dummy = { onIsDir() {}, onDirNotEmpty() {} };
        this.removeEntryFile(task, p, isAbsolute, dummy);
        return;
      }
      throw e;
    }
    if (this.errorSignal) {
      dir.closeSync();
      return;
    }
    const loopErr = this.removeChildren(task, dir, isAbsolute);
    if (loopErr) {
      this.handleErr(loopErr);
    }
    wait.value = true;
    task.needToWait = true;
    if (--task.subtaskCount !== 0) {
      return;
    }
    task.subtaskCount = 1;
    task.needToWait = false;
    wait.value = false;
    if (this.errorSignal) {
      return;
    }
    this.rmdirVerbose(task, p);
  }

  rmdirVerbose(task, p) {
    try {
      this.rmdir(p);
    } catch (e) {
      if (!(e.code === 'ENOENT' && this.opts.force)) {
        throw e;
      }
    }
    this.verboseDeleted(task, p);
  }

  /** Unlink the files of an open directory, enqueue its subdirectories. */
  removeChildren(task, dir, isAbsolute) {
    const p = task.path;
    const handler = {
      onIsDir: (parent, child) => this.enqueueNoJoin(parent, child, 'dir'),
      onDirNotEmpty: (parent, child) =>
        this.enqueueNoJoin(parent, child, 'dir'),
    };
    let i = 0;
    try {
      for (;;) {
        let ent;
        try {
          ent = dir.readSync();
        } catch (e) {
          return sysErrorFromNode(e, p);
        }
        if (ent === null) {
          return null;
        }
        if ((i & 3) === 0 && this.errorSignal) {
          return null;
        }
        i++;
        if (ent.isDirectory()) {
          this.enqueue(task, ent.name, isAbsolute, 'dir');
          continue;
        }
        try {
          const filePath = fileJoin(p, ent.name);
          this.removeEntryFile(task, filePath, isAbsolute, handler);
        } catch (e) {
          return e;
        }
      }
    } finally {
      dir.closeSync();
    }
  }

  /** Returns false when the directory was re-enqueued. */
  removeEntryDirAfterChildren(task) {
    const p = task.path;
    const state = { treatAsDir: true, allowEnqueue: true, enqueued: false };
    for (;;) {
      if (state.treatAsDir) {
        try {
          this.rmdir(p);
        } catch (e) {
          if (e.code === 'ENOTDIR') {
            state.treatAsDir = false;
            continue;
          }
          if (!(e.code === 'ENOENT' && this.opts.force)) {
            throw e;
          }
        }
        this.verboseDeleted(task, p);
        return true;
      }
      const handler = this.parentHandler(state);
      this.removeEntryFile(task, p, task.isAbsolute, handler);
      if (state.enqueued) {
        return false;
      }
      if (!state.treatAsDir) {
        return true;
      }
    }
  }

  /** Bun's `RemoveFileParent` handler. */
  parentHandler(state) {
    return {
      onIsDir() {
        state.treatAsDir = true;
      },
      onDirNotEmpty: (parent, p) => {
        state.treatAsDir = true;
        if (state.allowEnqueue) {
          this.enqueueNoJoin(parent, p, 'dir');
          state.enqueued = true;
        }
      },
    };
  }
}

/** A parse-time error: exit 1, or the errno when writing it failed. */
async function writeErr(b, msg) {
  const err = await b.write('stderr', msg);
  return err && b.needsIO('stderr') ? err.errno : 1;
}

function parseOpts(b) {
  const opts = {
    force: false,
    prompt: 'never',
    recursive: false,
    verbose: false,
    removeEmptyDirs: false,
  };
  for (let idx = 0; idx < b.args.length; idx++) {
    const arg = b.args[idx];
    const r = parseFlag(opts, arg);
    if (r === 'done') {
      return { opts, start: idx };
    }
    if (r === 'illegal') {
      return { error: 'rm: illegal option -- -\n' };
    }
    if (r === 'illegal-flag') {
      return { error: b.fmtErr(`illegal option -- ${arg.slice(1)}\n`) };
    }
  }
  return { error: USAGE.rm };
}

export async function rm(b) {
  const parsed = parseOpts(b);
  if (parsed.error) {
    return writeErr(b, parsed.error);
  }
  const { opts, start } = parsed;
  if (opts.recursive) {
    opts.removeEmptyDirs = true;
  }
  if (opts.prompt !== 'never') {
    return writeErr(b, NOT_SUPPORTED_I);
  }
  const cwd = b.shell.cwd;
  const operands = b.args.slice(start);
  for (const arg of operands) {
    const refused = refusedPath(cwd, arg);
    if (refused !== null) {
      return writeErr(b, b.fmtErr(`"${refused}" may not be removed\n`));
    }
  }
  const exec = { opts, cwd, errorSignal: false, verboseOut: [] };
  let failed = false;
  for (const arg of operands) {
    const task = new RmTask(exec, arg);
    task.run();
    for (const chunk of exec.verboseOut.splice(0)) {
      await b.write('stdout', chunk);
    }
    if (task.err !== null) {
      failed = true;
      await b.write('stderr', b.taskErrorToString(task.err));
    }
  }
  return failed ? 1 : 0;
}
