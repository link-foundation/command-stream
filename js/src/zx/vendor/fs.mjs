// Dependency-free implementation of the `fs-extra` (v11) API.
//
// The exported object contains every export of the runtime's `node:fs`
// module. Callback-style functions are "universalified": when called without
// a callback they return a Promise. On top of that the fs-extra helpers are
// provided (copy, move, remove, emptyDir, ensure*, output*, *Json, ...), each
// in an async (promise + optional callback) and a `*Sync` flavour.
//
// Every fs-extra helper is written once, as a generator that yields
// filesystem operations (`['stat', path]`, `['mkdir', dir, opts]`, ...).
// The generator is then driven either synchronously (via `fs.*Sync`) or
// asynchronously (via `fs.promises.*`), so both variants share their logic.

import nodeFs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Universalify native callback APIs
// ---------------------------------------------------------------------------

const CALLBACK_METHODS = [
  'access',
  'appendFile',
  'chmod',
  'chown',
  'close',
  'copyFile',
  'cp',
  'fchmod',
  'fchown',
  'fdatasync',
  'fstat',
  'fsync',
  'ftruncate',
  'futimes',
  'glob',
  'lchmod',
  'lchown',
  'lutimes',
  'link',
  'lstat',
  'mkdir',
  'mkdtemp',
  'open',
  'opendir',
  'readFile',
  'readdir',
  'readlink',
  'realpath',
  'rename',
  'rm',
  'rmdir',
  'stat',
  'statfs',
  'symlink',
  'truncate',
  'unlink',
  'utimes',
  'writeFile',
];

// Methods whose callback receives several results: (err, a, b).
const MULTI_RESULT_METHODS = {
  read: ['bytesRead', 'buffer'],
  readv: ['bytesRead', 'buffers'],
  write: ['bytesWritten', 'buffer'],
  writev: ['bytesWritten', 'buffers'],
};

function nameFn(fn, name) {
  return Object.defineProperty(fn, 'name', { value: name });
}

/**
 * Wrap a node-style callback function so that it returns a Promise when no
 * callback is passed. `pack` converts the callback results to one value.
 */
function fromCallback(fn, name, pack = (results) => results[0]) {
  return nameFn(function universalified(...args) {
    if (typeof args[args.length - 1] === 'function') {
      return fn.apply(this, args);
    }
    return new Promise((resolve, reject) => {
      fn.apply(this, [
        ...args,
        (err, ...results) => (err ? reject(err) : resolve(pack(results))),
      ]);
    });
  }, name);
}

/**
 * Wrap a promise-returning function so that a trailing callback argument,
 * when present, receives the outcome node-style.
 */
function fromPromise(fn, name) {
  return nameFn(function universalified(...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') {
      return fn.apply(this, args);
    }
    fn.apply(this, args.slice(0, -1)).then((res) => cb(null, res), cb);
    return undefined;
  }, name);
}

function exists(filename, cb) {
  if (typeof cb === 'function') {
    return nodeFs.exists(filename, cb);
  }
  return new Promise((resolve) => nodeFs.exists(filename, resolve));
}

function lchmodNoop(_path, _mode, cb) {
  process.nextTick(cb, null);
}

function buildBase() {
  const base = {};
  for (const key of Object.keys(nodeFs)) {
    base[key] = nodeFs[key];
  }
  for (const key of CALLBACK_METHODS) {
    if (typeof nodeFs[key] === 'function') {
      base[key] = fromCallback(nodeFs[key], key);
    }
  }
  for (const [key, names] of Object.entries(MULTI_RESULT_METHODS)) {
    if (typeof nodeFs[key] === 'function') {
      base[key] = fromCallback(nodeFs[key], key, (results) =>
        Object.fromEntries(names.map((n, i) => [n, results[i]]))
      );
    }
  }
  if (typeof base.lchmod !== 'function') {
    // Like graceful-fs: lchmod is only implemented on macOS; elsewhere it
    // is a no-op so that callers can use it unconditionally.
    base.lchmod = fromCallback(lchmodNoop, 'lchmod');
    base.lchmodSync = nameFn(() => undefined, 'lchmodSync');
  }
  if (typeof nodeFs.realpath.native === 'function') {
    base.realpath.native = fromCallback(nodeFs.realpath.native, 'native');
  }
  base.exists = exists;
  base.promises = nodeFs.promises;
  base.constants = nodeFs.constants;
  return base;
}

// ---------------------------------------------------------------------------
// Generator driver: run a generator of fs operations sync or async
// ---------------------------------------------------------------------------

function execSync([op, ...args]) {
  if (op === 'call') {
    return args[0](...args.slice(1));
  }
  return nodeFs[`${op}Sync`](...args);
}

function execAsync([op, ...args]) {
  if (op === 'call') {
    return Promise.resolve(args[0](...args.slice(1)));
  }
  return nodeFs.promises[op](...args);
}

/**
 * Drive `gen` to completion. In async mode every operation result is awaited
 * and a Promise is returned; in sync mode the plain value is returned.
 */
function drive(gen, isAsync) {
  const exec = isAsync ? execAsync : execSync;
  const step = (method, arg) => {
    let m = method;
    let a = arg;
    for (;;) {
      const s = gen[m](a);
      if (s.done) {
        return s.value;
      }
      try {
        a = exec(s.value);
        m = 'next';
      } catch (err) {
        a = err;
        m = 'throw';
        continue;
      }
      if (isAsync) {
        return a.then(
          (v) => step('next', v),
          (e) => step('throw', e)
        );
      }
    }
  };
  if (!isAsync) {
    return step('next', undefined);
  }
  return new Promise((resolve) => resolve(step('next', undefined)));
}

/** Create `[asyncFn, syncFn]` from an operation generator function. */
function makePair(name, genFn) {
  const asyncFn = fromPromise((...args) => drive(genFn(...args), true), name);
  const syncFn = nameFn(
    (...args) => drive(genFn(...args), false),
    `${name}Sync`
  );
  return [asyncFn, syncFn];
}

// ---------------------------------------------------------------------------
// Shared operation generators
// ---------------------------------------------------------------------------

/** stat/lstat that yields `null` instead of throwing ENOENT. */
function* statMaybe(p, useLstat = false) {
  try {
    return yield [useLstat ? 'lstat' : 'stat', p];
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return null;
    }
    throw err;
  }
}

function* mkdirsOp(dir, options) {
  const mode = typeof options === 'number' ? options : options?.mode;
  return yield [
    'mkdir',
    path.resolve(dir),
    { recursive: true, mode: mode ?? 0o777 },
  ];
}

function* removeOp(p) {
  yield ['rm', p, { recursive: true, force: true }];
}

function* emptyDirOp(dir) {
  let items;
  try {
    items = yield ['readdir', dir];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    yield* mkdirsOp(dir);
    return;
  }
  for (const item of items) {
    yield* removeOp(path.join(dir, item));
  }
}

function* ensureFileOp(file) {
  const st = yield* statMaybe(file);
  if (st && st.isFile()) {
    return;
  }
  const dir = path.dirname(file);
  const dirStat = yield* statMaybe(dir);
  if (!dirStat) {
    yield* mkdirsOp(dir);
  } else if (!dirStat.isDirectory()) {
    yield ['readdir', dir]; // throws ENOTDIR like fs-extra
  }
  yield ['writeFile', file, ''];
}

function areIdentical(a, b) {
  return Boolean(b.ino && b.dev && a.ino === b.ino && a.dev === b.dev);
}

function* lstatFor(p, fnName) {
  try {
    return yield ['lstat', p];
  } catch (err) {
    err.message = err.message.replace('lstat', fnName);
    throw err;
  }
}

function* ensureLinkOp(srcpath, dstpath) {
  const dstStat = yield* statMaybe(dstpath, true);
  const srcStat = yield* lstatFor(srcpath, 'ensureLink');
  if (dstStat && areIdentical(srcStat, dstStat)) {
    return;
  }
  yield* mkdirsOp(path.dirname(dstpath));
  yield ['link', srcpath, dstpath];
}

/** Resolve the symlink target relative to cwd and to the link location. */
function* symlinkPaths(srcpath, dstpath) {
  if (path.isAbsolute(srcpath)) {
    yield* lstatFor(srcpath, 'ensureSymlink');
    return { toCwd: srcpath, toDst: srcpath };
  }
  const dstdir = path.dirname(dstpath);
  const relativeToDst = path.join(dstdir, srcpath);
  if (yield* statMaybe(relativeToDst, true)) {
    return { toCwd: relativeToDst, toDst: srcpath };
  }
  yield* lstatFor(srcpath, 'ensureSymlink');
  return { toCwd: srcpath, toDst: path.relative(dstdir, srcpath) };
}

function* ensureSymlinkOp(srcpath, dstpath, type) {
  const dstStat = yield* statMaybe(dstpath, true);
  if (dstStat && dstStat.isSymbolicLink()) {
    const [a, b] = [yield* statMaybe(srcpath), yield* statMaybe(dstpath)];
    if (a && b && areIdentical(a, b)) {
      return;
    }
  }
  const rel = yield* symlinkPaths(srcpath, dstpath);
  let linkType = type;
  if (!linkType) {
    const st = yield* statMaybe(rel.toCwd, true);
    linkType = st && st.isDirectory() ? 'dir' : 'file';
  }
  yield* mkdirsOp(path.dirname(dstpath));
  yield ['symlink', rel.toDst, dstpath, linkType];
}

function* outputFileOp(file, data, encoding) {
  const dir = path.dirname(file);
  if (!(yield* statMaybe(dir))) {
    yield* mkdirsOp(dir);
  }
  yield ['writeFile', file, data, encoding];
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function stripBom(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  return str.replace(/^\uFEFF/, '');
}

function jsonOptions(options) {
  if (typeof options === 'string') {
    return { encoding: options };
  }
  return options || {};
}

function stringifyJson(obj, options = {}) {
  const { EOL = '\n', finalEOL = true, replacer = null, spaces } = options;
  const str = JSON.stringify(obj, replacer, spaces);
  return str.replace(/\n/g, EOL) + (finalEOL ? EOL : '');
}

function* readJsonOp(file, options) {
  const opts = jsonOptions(options);
  const shouldThrow = 'throws' in opts ? opts.throws : true;
  const content = yield ['readFile', file, opts];
  try {
    return JSON.parse(stripBom(content), opts.reviver);
  } catch (err) {
    if (!shouldThrow) {
      return null;
    }
    err.message = `${file}: ${err.message}`;
    throw err;
  }
}

function* writeJsonOp(file, obj, options) {
  const opts = jsonOptions(options);
  yield ['writeFile', file, stringifyJson(obj, opts), opts];
}

function* outputJsonOp(file, obj, options) {
  const opts = jsonOptions(options);
  yield* outputFileOp(file, stringifyJson(obj, opts), opts);
}

// ---------------------------------------------------------------------------
// copy / move
// ---------------------------------------------------------------------------

function isSrcSubdir(src, dest) {
  const srcParts = path.resolve(src).split(path.sep).filter(Boolean);
  const destParts = path.resolve(dest).split(path.sep).filter(Boolean);
  return srcParts.every((part, i) => destParts[i] === part);
}

function* checkPaths(src, dest, funcName, opts) {
  const useLstat = !opts.dereference;
  const srcStat = yield [useLstat ? 'lstat' : 'stat', src];
  const destStat = yield* statMaybe(dest, useLstat);
  if (destStat) {
    if (areIdentical(srcStat, destStat)) {
      const srcBase = path.basename(src);
      const destBase = path.basename(dest);
      if (
        funcName === 'move' &&
        srcBase !== destBase &&
        srcBase.toLowerCase() === destBase.toLowerCase()
      ) {
        return { srcStat, destStat, isChangingCase: true };
      }
      throw new Error('Source and destination must not be the same.');
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw new Error(
        `Cannot overwrite non-directory '${dest}' with directory '${src}'.`
      );
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw new Error(
        `Cannot overwrite directory '${dest}' with non-directory '${src}'.`
      );
    }
  }
  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw new Error(
      `Cannot ${funcName} '${src}' to a subdirectory of itself, '${dest}'.`
    );
  }
  return { srcStat, destStat, isChangingCase: false };
}

function* copyFileEntry(srcStat, destStat, src, dest, opts) {
  if (destStat) {
    if (!opts.overwrite) {
      if (opts.errorOnExist) {
        throw new Error(`'${dest}' already exists`);
      }
      return;
    }
    yield ['unlink', dest];
  }
  yield ['copyFile', src, dest];
  if (opts.preserveTimestamps) {
    if ((srcStat.mode & 0o200) === 0) {
      yield ['chmod', dest, srcStat.mode | 0o200];
    }
    yield ['utimes', dest, srcStat.atime, srcStat.mtime];
  }
  yield ['chmod', dest, srcStat.mode];
}

function* copyLink(destStat, src, dest, opts) {
  let target = yield ['readlink', src];
  if (opts.dereference) {
    target = path.resolve(process.cwd(), target);
  }
  if (destStat) {
    yield ['unlink', dest];
  }
  yield ['symlink', target, dest];
}

function* copyDir(srcStat, destStat, src, dest, opts) {
  if (!destStat) {
    yield ['mkdir', dest];
  }
  const items = yield ['readdir', src];
  for (const item of items) {
    const srcItem = path.join(src, item);
    const destItem = path.join(dest, item);
    if (opts.filter && !(yield ['call', opts.filter, srcItem, destItem])) {
      continue;
    }
    const checked = yield* checkPaths(srcItem, destItem, 'copy', opts);
    yield* copyEntry(checked.destStat, srcItem, destItem, opts);
  }
  if (!destStat) {
    yield ['chmod', dest, srcStat.mode];
  }
}

function* copyEntry(destStat, src, dest, opts) {
  const srcStat = yield [opts.dereference ? 'stat' : 'lstat', src];
  if (srcStat.isDirectory()) {
    return yield* copyDir(srcStat, destStat, src, dest, opts);
  }
  if (srcStat.isSymbolicLink()) {
    return yield* copyLink(destStat, src, dest, opts);
  }
  if (
    srcStat.isFile() ||
    srcStat.isCharacterDevice() ||
    srcStat.isBlockDevice()
  ) {
    return yield* copyFileEntry(srcStat, destStat, src, dest, opts);
  }
  if (srcStat.isSocket()) {
    throw new Error(`Cannot copy a socket file: ${src}`);
  }
  if (srcStat.isFIFO()) {
    throw new Error(`Cannot copy a FIFO pipe: ${src}`);
  }
  throw new Error(`Unknown file: ${src}`);
}

function copyOptions(options) {
  const opts =
    typeof options === 'function' ? { filter: options } : { ...options };
  if (!('overwrite' in opts)) {
    opts.overwrite = 'clobber' in opts ? Boolean(opts.clobber) : true;
  }
  return opts;
}

function* copyOp(src, dest, options) {
  const opts = copyOptions(options);
  const { destStat } = yield* checkPaths(src, dest, 'copy', opts);
  if (opts.filter && !(yield ['call', opts.filter, src, dest])) {
    return;
  }
  const destParent = path.dirname(dest);
  if (!(yield* statMaybe(destParent))) {
    yield* mkdirsOp(destParent);
  }
  yield* copyEntry(destStat, src, dest, opts);
}

function* moveOp(src, dest, options = {}) {
  const overwrite = Boolean(options.overwrite || options.clobber);
  const { isChangingCase } = yield* checkPaths(src, dest, 'move', options);
  const destParent = path.dirname(path.resolve(dest));
  if (destParent !== path.parse(destParent).root) {
    yield* mkdirsOp(destParent);
  }
  if (!isChangingCase) {
    if (overwrite) {
      yield* removeOp(dest);
    } else if (yield* statMaybe(dest, true)) {
      throw new Error('dest already exists.');
    }
  }
  try {
    yield ['rename', src, dest];
  } catch (err) {
    if (err.code !== 'EXDEV') {
      throw err;
    }
    const copyOpts = {
      overwrite,
      errorOnExist: true,
      preserveTimestamps: true,
    };
    yield* copyOp(src, dest, copyOpts);
    yield* removeOp(src);
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function* pathExistsOp(p) {
  try {
    yield ['access', p];
    return true;
  } catch {
    return false;
  }
}

function toUnixTimestamp(time) {
  if (typeof time === 'string' && String(Number(time)) === time.trim()) {
    return Number(time);
  }
  if (typeof time === 'number' && Number.isFinite(time)) {
    return time < 0 ? Date.now() / 1000 : time;
  }
  if (time instanceof Date) {
    return time.getTime() / 1000;
  }
  throw new Error(`Cannot parse time: ${time}`);
}

function gracefulify(fsModule) {
  return fsModule;
}

// ---------------------------------------------------------------------------
// Assemble the module
// ---------------------------------------------------------------------------

const EXTRAS = [
  ['copy', copyOp],
  ['move', moveOp],
  ['remove', removeOp],
  ['emptyDir', emptyDirOp, ['emptydir']],
  ['ensureDir', mkdirsOp, ['mkdirs', 'mkdirp']],
  ['ensureFile', ensureFileOp, ['createFile']],
  ['ensureLink', ensureLinkOp, ['createLink']],
  ['ensureSymlink', ensureSymlinkOp, ['createSymlink']],
  ['outputFile', outputFileOp],
  ['outputJson', outputJsonOp, ['outputJSON']],
  ['readJson', readJsonOp, ['readJSON']],
  ['writeJson', writeJsonOp, ['writeJSON']],
  ['pathExists', pathExistsOp],
];

function buildFsExtra() {
  const fse = buildBase();
  for (const [name, genFn, aliases = []] of EXTRAS) {
    const [asyncFn, syncFn] = makePair(name, genFn);
    for (const alias of [name, ...aliases]) {
      fse[alias] = asyncFn;
      fse[`${alias}Sync`] = syncFn;
    }
  }
  fse.pathExistsSync = nodeFs.existsSync;
  fse.gracefulify = gracefulify;
  if (typeof fse._toUnixTimestamp !== 'function') {
    fse._toUnixTimestamp = toUnixTimestamp;
  }
  Object.defineProperty(fse, 'default', {
    value: fse,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return fse;
}

const fse = buildFsExtra();

export default fse;

export { stringifyJson, stripBom, toUnixTimestamp };

/**
 * Internal helpers shared with sibling vendor modules (e.g. glob): run a
 * generator of fs operations synchronously or asynchronously.
 */
export const _internal = { drive, statMaybe };

export const {
  // node:fs natives (present when the running runtime provides them)
  Dir,
  Dirent,
  FileReadStream,
  FileWriteStream,
  ReadStream,
  Stats,
  Utf8Stream,
  WriteStream,
  _toUnixTimestamp,
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  exists: existsFn,
  existsSync,
  fchmod,
  fchmodSync,
  fchown,
  fchownSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  glob,
  globSync,
  lchmod,
  lchmodSync,
  lchown,
  lchownSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempDisposableSync,
  mkdtempSync,
  open,
  openAsBlob,
  openSync,
  opendir,
  opendirSync,
  promises,
  read,
  readFile,
  readFileSync,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  readv,
  readvSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  rmdir,
  rmdirSync,
  stat,
  statSync,
  statfs,
  statfsSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  unwatchFile,
  utimes,
  utimesSync,
  watch,
  watchFile,
  write,
  writeFile,
  writeFileSync,
  writeSync,
  writev,
  writevSync,
  // fs-extra helpers
  copy,
  copySync,
  createFile,
  createFileSync,
  createLink,
  createLinkSync,
  createSymlink,
  createSymlinkSync,
  emptyDir,
  emptyDirSync,
  emptydir,
  emptydirSync,
  ensureDir,
  ensureDirSync,
  ensureFile,
  ensureFileSync,
  ensureLink,
  ensureLinkSync,
  ensureSymlink,
  ensureSymlinkSync,
  gracefulify: gracefulifyFn,
  mkdirp,
  mkdirpSync,
  mkdirs,
  mkdirsSync,
  move,
  moveSync,
  outputFile,
  outputFileSync,
  outputJSON,
  outputJSONSync,
  outputJson,
  outputJsonSync,
  pathExists,
  pathExistsSync,
  readJSON,
  readJSONSync,
  readJson,
  readJsonSync,
  remove,
  removeSync,
  writeJSON,
  writeJSONSync,
  writeJson,
  writeJsonSync,
} = fse;

export { existsFn as exists, gracefulifyFn as gracefulify };
