// Path helpers for zx test ports that compare shell output with Node paths
// (issue #26). Git Bash on Windows prints POSIX paths: `D:\a` is `/d/a` and
// %TEMP% is `/tmp`, while Node sees `D:\tmp` for `/tmp`. Upstream runs these
// tests on POSIX only. Every helper is the identity outside Windows, so the
// upstream vectors stay unchanged there.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { $ } from '../../../src/zx/index.mjs';

const isWin = process.platform === 'win32';
const shell = $.shell;

// The path travels in the environment: the MSYS runtime re-parses argv.
function cygpath(flag, p) {
  const { stdout, status, stderr } = spawnSync(
    shell,
    ['-c', `cygpath ${flag} "$CYGPATH_ARG"`],
    { encoding: 'utf8', env: { ...process.env, CYGPATH_ARG: p } }
  );
  if (status !== 0) {
    throw new Error(`cygpath ${flag} ${p}: ${stderr}`);
  }
  return stdout.trim();
}

/**
 * A Node path for a path printed by the shell, with long names and one case.
 *
 * @param {string} p Shell (or Node) path.
 * @returns {string} Comparable native path.
 */
export function nativePath(p) {
  if (!isWin) {
    return p;
  }
  const win = p.startsWith('/') ? cygpath('-w', p) : p;
  return fs.realpathSync.native(win).toLowerCase();
}

/**
 * The shell's spelling of a Node path (`D:\a` -> `/d/a` in Git Bash).
 *
 * @param {string} p Node path.
 * @returns {string} Shell path.
 */
export const shellPath = (p) => (isWin ? cygpath('-u', p) : p);

/**
 * Whether `pwd` output names `dir`. Upstream checks `endsWith(dir)`, which
 * also covers macOS's `/private` prefix.
 *
 * @param {string} pwd Shell output.
 * @param {string} dir Node path.
 * @returns {boolean} True when both name the same directory.
 */
export const isPwd = (pwd, dir) =>
  isWin ? nativePath(pwd.trim()) === nativePath(dir) : pwd.trim().endsWith(dir);

// The directory the shell calls `/tmp`.
export const TMP = isWin ? cygpath('-w', '/tmp') : '/tmp';

/**
 * Forward slashes, so `endsWith('/two')` style checks work on Windows.
 *
 * @param {string} p Path.
 * @returns {string} Path with `/` separators.
 */
export const slash = (p) => p.split(path.sep).join('/');
