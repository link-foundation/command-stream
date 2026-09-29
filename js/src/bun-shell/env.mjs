// Shell execution environment, ported from Bun's `ShellExecEnv` and `EnvMap`
// (src/runtime/shell/interpreter.rs, EnvMap.rs).

import fs from 'node:fs';
import path from 'node:path';
import { ByteList, ShellSysError, sysErrorFromNode } from './io.mjs';

const IS_WINDOWS = process.platform === 'win32';
const PATH_MAX = 4096;

/**
 * Insertion-ordered string map; keys compare case-insensitively on Windows
 * (the first spelling of a key is kept), like Bun's `EnvMap`.
 */
export class EnvMap {
  constructor(entries) {
    this.map = new Map();
    if (entries) {
      for (const [k, v] of entries) {
        this.set(k, v);
      }
    }
  }

  static norm(key) {
    return IS_WINDOWS ? key.toUpperCase() : key;
  }

  get(key) {
    return this.map.get(EnvMap.norm(key))?.[1];
  }

  has(key) {
    return this.map.has(EnvMap.norm(key));
  }

  set(key, value) {
    const k = EnvMap.norm(key);
    const existing = this.map.get(k);
    this.map.set(k, [existing ? existing[0] : key, value]);
  }

  *entries() {
    for (const [, kv] of this.map) {
      yield kv;
    }
  }

  clone() {
    const m = new EnvMap();
    m.map = new Map(this.map);
    return m;
  }

  get size() {
    return this.map.size;
  }
}

/** Build the export env from a JS object (ParsedShellScript#setEnv). */
export function envMapFromObject(obj) {
  const env = new EnvMap();
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === undefined) {
      continue;
    }
    env.set(key, String(value));
  }
  return env;
}

export const EnvKind = Object.freeze({
  NORMAL: 'normal',
  CMD_SUBST: 'cmd_subst',
  SUBSHELL: 'subshell',
  PIPELINE: 'pipeline',
});

export class ShellExecEnv {
  constructor({
    shellEnv = new EnvMap(),
    exportEnv = new EnvMap(),
    cmdLocalEnv = new EnvMap(),
    cwd,
    prevCwd = cwd,
    bufferedStdout = new ByteList(),
    bufferedStderr = new ByteList(),
  }) {
    this.shellEnv = shellEnv;
    this.exportEnv = exportEnv;
    this.cmdLocalEnv = cmdLocalEnv;
    this.cwd = cwd;
    this.prevCwd = prevCwd;
    this.bufferedStdout = bufferedStdout;
    this.bufferedStderr = bufferedStderr;
  }

  /**
   * A child environment for a subshell, pipeline item or command
   * substitution. Buffered output is shared with the parent only for
   * subshells and pipeline items writing to a pipe; captured fd outputs
   * share the captured buffer.
   */
  dupeForSubshell(io, kind) {
    const bufFor = (out, parentBuf) => {
      if (out.kind === 'fd') {
        return out.captured ?? new ByteList();
      }
      if (out.kind === 'pipe') {
        return kind === EnvKind.SUBSHELL || kind === EnvKind.PIPELINE
          ? parentBuf
          : new ByteList();
      }
      return new ByteList();
    };
    return new ShellExecEnv({
      shellEnv: this.shellEnv.clone(),
      exportEnv: this.exportEnv.clone(),
      cwd: this.cwd,
      prevCwd: this.prevCwd,
      bufferedStdout: bufFor(io.stdout, this.bufferedStdout),
      bufferedStderr: bufFor(io.stderr, this.bufferedStderr),
    });
  }

  /** Resolve `p` against the shell's cwd. */
  resolve(p) {
    return path.resolve(this.cwd, p);
  }

  /**
   * Change directory (Bun's `change_cwd_impl`): the target must open as a
   * directory; updates OLDPWD (unless initialising) and PWD.
   * Throws a ShellSysError on failure.
   */
  changeCwd(newCwd, inInit = false) {
    const isAbs = path.isAbsolute(newCwd);
    const required = isAbs
      ? newCwd.length
      : this.cwd.length + 1 + newCwd.length;
    if (required >= PATH_MAX) {
      throw new ShellSysError('ENAMETOOLONG', { syscall: 'chdir' });
    }
    let target = isAbs ? newCwd : path.join(this.cwd, newCwd);
    if (!isAbs && target.length > 1 && /[\\/]$/.test(target)) {
      target = target.slice(0, -1);
    }
    let st;
    try {
      st = fs.statSync(path.resolve(this.cwd, target));
    } catch (e) {
      throw sysErrorFromNode({ ...e, syscall: 'open' }, target);
    }
    if (!st.isDirectory()) {
      throw new ShellSysError('ENOTDIR', { path: target, syscall: 'open' });
    }
    try {
      fs.accessSync(path.resolve(this.cwd, target), fs.constants.R_OK);
    } catch (e) {
      throw sysErrorFromNode({ ...e, syscall: 'open' }, target);
    }
    this.prevCwd = this.cwd;
    this.cwd = target;
    if (!inInit) {
      this.exportEnv.set('OLDPWD', this.prevCwd);
    }
    this.exportEnv.set('PWD', this.cwd);
  }

  changePrevCwd() {
    this.changeCwd(this.prevCwd);
  }

  assignVar(label, value, ctx) {
    if (ctx === 'cmd') {
      this.cmdLocalEnv.set(label, value);
    } else {
      this.shellEnv.set(label, value);
    }
  }

  /** `$NAME` lookup: shell variables first, then exported ones. */
  getVar(name) {
    return this.shellEnv.get(name) ?? this.exportEnv.get(name);
  }

  getHomedir() {
    return this.getVar(IS_WINDOWS ? 'USERPROFILE' : 'HOME') ?? '';
  }
}
