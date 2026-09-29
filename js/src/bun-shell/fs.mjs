// `node:fs` for the shell, with the Deno node-compat differences the
// interpreter and builtins depend on smoothed over (Deno 2.x):
//
// - `fs.opendirSync` rejects a missing `bufferSize` option;
// - `Dir#readSync` yields string names even with `encoding: 'buffer'`;
// - `fs.unlinkSync` removes an empty directory (and reports ENOTEMPTY for a
//   non-empty one) instead of failing like unlink(2), so `rm dir` would
//   delete it.
//
// On Node.js and Bun every function is `node:fs`'s own.

import nodeFs from 'node:fs';
import { constants } from 'node:os';

const IS_DENO = typeof globalThis.Deno !== 'undefined';

// What unlink(2) on a directory fails with: EISDIR on Linux, EPERM elsewhere.
const UNLINK_DIR_CODE = ['linux', 'android'].includes(process.platform)
  ? 'EISDIR'
  : 'EPERM';

function opendirSync(path, options = {}) {
  const dir = nodeFs.opendirSync(path, { bufferSize: 32, ...options });
  if (options.encoding === 'buffer') {
    const readSync = dir.readSync.bind(dir);
    dir.readSync = () => {
      const entry = readSync();
      if (typeof entry?.name === 'string') {
        entry.name = Buffer.from(entry.name);
      }
      return entry;
    };
  }
  return dir;
}

function unlinkSync(path) {
  let isDirectory = false;
  try {
    isDirectory = nodeFs.lstatSync(path).isDirectory();
  } catch {
    // Let unlink report the error (ENOENT, EACCES, ...).
  }
  if (isDirectory) {
    const code = UNLINK_DIR_CODE;
    throw Object.assign(new Error(`${code}: unlink '${path}'`), {
      code,
      errno: -constants.errno[code],
      syscall: 'unlink',
      path: String(path),
    });
  }
  return nodeFs.unlinkSync(path);
}

const fs = IS_DENO ? { ...nodeFs, opendirSync, unlinkSync } : nodeFs;

export default fs;
