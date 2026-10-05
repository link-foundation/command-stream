// Dependency-free implementation of the `globby` (v14+) API.
//
//   await glob('*.md')                          -> ['README.md']
//   glob.sync(['src/**/*.js', '!**/*.test.js'])  -> [...]
//   for await (const p of glob.globbyStream('**')) { ... }
//
// Supported syntax: `*`, `**`, `?`, `[abc]`, `[a-z]`, `[!a]`, POSIX classes,
// braces `{a,b}` (nested) and ranges `{1..3}`, extglobs `@(a|b)`, `*(a)`,
// `+(a)`, `?(a)`, `!(a)`, backslash escapes and `!negated` patterns.
//
// Results are posix-style paths (forward slashes on every platform), in a
// deterministic order: directories are walked breadth-first and entries of
// each directory are sorted by name.

import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { _internal } from './fs.mjs';

const { drive, statMaybe } = _internal;

const IS_WIN = process.platform === 'win32';
const GLOBSTAR = Symbol('globstar');
const SEGMENT_END = '(?:/|$)';
const MAX_RANGE = 10000;
const EXTGLOB_SUFFIX = { '*': '*', '?': '?', '+': '+', '@': '' };
const POSIX_CLASSES = {
  alnum: 'a-zA-Z0-9',
  alpha: 'a-zA-Z',
  blank: ' \\t',
  digit: '0-9',
  lower: 'a-z',
  space: '\\s',
  upper: 'A-Z',
  word: '\\w',
  xdigit: 'A-Fa-f0-9',
};
const DEFAULT_IGNORE_FILES_IGNORE = [
  '**/node_modules',
  '**/bower_components',
  '**/flow-typed',
  '**/coverage',
  '**/.git',
];
const IGNORED_READDIR_ERRORS = new Set(['ENOENT', 'ENOTDIR']);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toPath(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  if (typeof value === 'string' && value.startsWith('file:')) {
    return fileURLToPath(value);
  }
  return value;
}

function toPosix(p) {
  return IS_WIN ? p.replace(/\\/g, '/') : p;
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function escapeClassChar(c) {
  return /[\\\]^[-]/.test(c) ? `\\${c}` : c;
}

function unescapeGlob(str) {
  return str.replace(/\\(.)/g, '$1');
}

function byName(a, b) {
  if (a.name === b.name) {
    return 0;
  }
  return a.name < b.name ? -1 : 1;
}

/** Index of the bracket closing the one at `start`, honouring escapes. */
function findClosing(str, start, open, close) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (c === '\\') {
      i++;
    } else if (c === open) {
      depth++;
    } else if (c === close && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Split `str` on `sep` occurring outside of braces/parentheses. */
function splitTopLevel(str, sep) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\') {
      i++;
    } else if (c === '{' || c === '(') {
      depth++;
    } else if (c === '}' || c === ')') {
      depth--;
    } else if (c === sep && depth === 0) {
      parts.push(str.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(str.slice(last));
  return parts;
}

// ---------------------------------------------------------------------------
// Brace expansion
// ---------------------------------------------------------------------------

function padNumber(n, width) {
  if (n < 0) {
    return `-${String(-n).padStart(width - 1, '0')}`;
  }
  return String(n).padStart(width, '0');
}

function numericRange(m) {
  const [a, b] = [Number(m[1]), Number(m[2])];
  const step = Math.abs(Number(m[3] || 1)) || 1;
  const padded = /^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2]);
  const width = padded ? Math.max(m[1].length, m[2].length) : 0;
  const dir = a <= b ? 1 : -1;
  const out = [];
  for (let n = a; dir > 0 ? n <= b : n >= b; n += dir * step) {
    if (out.length >= MAX_RANGE) {
      break;
    }
    out.push(padNumber(n, width));
  }
  return out;
}

function expandRange(inner) {
  const num = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(inner);
  if (num) {
    return numericRange(num);
  }
  const alpha = /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(inner);
  if (!alpha) {
    return null;
  }
  const [a, b] = [alpha[1].charCodeAt(0), alpha[2].charCodeAt(0)];
  const dir = a <= b ? 1 : -1;
  const out = [];
  for (let c = a; dir > 0 ? c <= b : c >= b; c += dir) {
    out.push(String.fromCharCode(c));
  }
  return out;
}

/**
 * Expand `{a,b}` alternatives and `{1..3}` ranges (nested braces allowed).
 * @param {string} pattern
 * @returns {string[]}
 */
export function expandBraces(pattern) {
  const str = String(pattern);
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
      continue;
    }
    if (str[i] !== '{') {
      continue;
    }
    const close = findClosing(str, i, '{', '}');
    if (close === -1) {
      return [str];
    }
    const inner = str.slice(i + 1, close);
    const parts = splitTopLevel(inner, ',');
    const alts = parts.length > 1 ? parts : expandRange(inner);
    if (alts) {
      const pre = str.slice(0, i);
      const post = str.slice(close + 1);
      return alts.flatMap((alt) => expandBraces(pre + alt + post));
    }
  }
  return [str];
}

// ---------------------------------------------------------------------------
// Glob -> RegExp compilation
// ---------------------------------------------------------------------------

/** Parse a `[...]` character class starting at `start`. */
function parseClass(str, start) {
  let j = start + 1;
  const negate = str[j] === '!' || str[j] === '^';
  if (negate) {
    j++;
  }
  let body = '';
  for (let first = true; j < str.length; j++, first = false) {
    const c = str[j];
    if (c === ']' && !first) {
      return { src: negate ? `[^/${body}]` : `[${body}]`, end: j };
    }
    const posix = c === '[' && /^\[:(\w+):\]/.exec(str.slice(j));
    if (posix && POSIX_CLASSES[posix[1]]) {
      body += POSIX_CLASSES[posix[1]];
      j += posix[0].length - 1;
    } else if (c === '\\' && j + 1 < str.length) {
      body += escapeClassChar(str[++j]);
    } else {
      body += c === '-' ? c : escapeClassChar(c);
    }
  }
  return null;
}

/** Try to compile an extglob `X(...)` at `i`; returns null when absent. */
function compileExtglob(str, i, opts) {
  if (
    opts.extglob === false ||
    str[i + 1] !== '(' ||
    !'*?+@!'.includes(str[i])
  ) {
    return null;
  }
  const close = findClosing(str, i + 1, '(', ')');
  if (close === -1) {
    return null;
  }
  const alts = splitTopLevel(str.slice(i + 2, close), '|')
    .map((alt) => compileSource(alt, opts))
    .join('|');
  if (str[i] === '!') {
    const rest = compileSource(str.slice(close + 1), opts);
    const src = `(?:(?!(?:${alts})${rest}${SEGMENT_END})[^/]*?)${rest}`;
    return { src, end: str.length - 1 };
  }
  return { src: `(?:${alts})${EXTGLOB_SUFFIX[str[i]]}`, end: close };
}

/** Compile a glob segment (without slashes) to regexp source. */
function compileSource(str, opts) {
  let src = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const ext = compileExtglob(str, i, opts);
    const cls = !ext && c === '[' ? parseClass(str, i) : null;
    if (ext || cls) {
      src += (ext || cls).src;
      i = (ext || cls).end;
    } else if (c === '\\' && i + 1 < str.length) {
      src += escapeRe(str[++i]);
    } else if (c === '*') {
      src += '[^/]*';
      while (str[i + 1] === '*') {
        i++;
      }
    } else if (c === '?') {
      src += '[^/]';
    } else {
      src += escapeRe(c);
    }
  }
  return src;
}

/** Guard preventing wildcards from matching dot-files (and `.`/`..`). */
function dotGuard(segment, opts) {
  if (segment.startsWith('.')) {
    return '';
  }
  return opts.dot ? `(?!\\.{1,2}${SEGMENT_END})` : '(?!\\.)';
}

/** Whether a glob string contains unescaped magic characters. */
function hasMagic(str) {
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\') {
      i++;
    } else if (c === '*' || c === '?') {
      return true;
    } else if (c === '[' && parseClass(str, i)) {
      return true;
    } else if ('+@!'.includes(c) && str[i + 1] === '(') {
      return (
        findClosing(str, i + 1, '(', ')') !== -1 || hasMagic(str.slice(i + 1))
      );
    }
  }
  return false;
}

function compileSegment(seg, opts) {
  if (seg === '**') {
    return GLOBSTAR;
  }
  if (!hasMagic(seg)) {
    const literal = unescapeGlob(seg);
    if (opts.nocase) {
      const lower = literal.toLowerCase();
      return { test: (name) => name.toLowerCase() === lower };
    }
    return { test: (name) => name === literal };
  }
  const re = new RegExp(
    `^${dotGuard(seg, opts)}${compileSource(seg, opts)}$`,
    opts.nocase ? 'i' : ''
  );
  return { test: (name) => re.test(name) };
}

function splitPattern(pattern) {
  const parts = pattern.split('/');
  // collapse consecutive globstars and empty inner segments
  return parts.filter(
    (part, i) =>
      (i === 0 || part !== '') && !(part === '**' && parts[i - 1] === '**')
  );
}

/**
 * Compile a (brace-free) glob into a segment matcher.
 * @returns {{segs: Array, dirOnly: boolean, starOk: Function}}
 */
function compileMatcher(pattern, opts) {
  const dirOnly = pattern.length > 1 && pattern.endsWith('/');
  const clean = dirOnly ? pattern.replace(/\/+$/, '') : pattern;
  const segs = splitPattern(clean).map((seg) => compileSegment(seg, opts));
  const starOk = (name) =>
    name !== '.' && name !== '..' && (opts.dot || !name.startsWith('.'));
  return { segs, dirOnly, starOk };
}

/**
 * Match path `parts` against the matcher. With `partial`, answer whether a
 * descendant of the directory `parts` could still match.
 */
function matchSegments(m, parts, partial, si = 0, pi = 0) {
  const { segs } = m;
  let s = si;
  let p = pi;
  while (s < segs.length && segs[s] !== GLOBSTAR) {
    if (p >= parts.length) {
      return partial;
    }
    if (!segs[s].test(parts[p])) {
      return false;
    }
    s++;
    p++;
  }
  if (s === segs.length) {
    return !partial && p === parts.length;
  }
  for (let k = p; ; k++) {
    if (partial && k >= parts.length) {
      return true;
    }
    if (matchSegments(m, parts, partial, s + 1, k)) {
      return true;
    }
    if (k >= parts.length || !m.starOk(parts[k])) {
      return false;
    }
  }
}

/** Does the full path (as parts) match the matcher? */
function matchFull(m, parts) {
  return matchSegments(m, parts, false);
}

/** Could a descendant of the directory `parts` match the matcher? */
function matchPartial(m, parts) {
  return matchSegments(m, parts, true);
}

function patternSource(pattern, opts) {
  const segs = splitPattern(pattern);
  const part = `${dotGuard('', opts)}[^/]*`;
  let src = '';
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (seg !== '**') {
      src += `${dotGuard(seg, opts)}${compileSource(seg, opts)}${last ? '' : '/'}`;
    } else if (!last) {
      src += `(?:${part}/)*`;
    } else if (i === 0) {
      src += `(?:${part}(?:/${part})*)?`;
    } else {
      src = `${src.slice(0, -1)}(?:/${part})*`;
    }
  });
  return src;
}

/**
 * Convert a glob pattern to a RegExp matching whole posix paths.
 * @param {string} pattern
 * @param {{dot?: boolean, nocase?: boolean, caseSensitiveMatch?: boolean}} [options]
 * @returns {RegExp}
 */
export function globToRegExp(pattern, options = {}) {
  const opts = {
    dot: Boolean(options.dot),
    nocase: Boolean(options.nocase) || options.caseSensitiveMatch === false,
    extglob: options.extglob,
  };
  const sources = expandBraces(stripDotSlash(String(pattern))).map((p) =>
    patternSource(p, opts)
  );
  return new RegExp(`^(?:${sources.join('|')})$`, opts.nocase ? 'i' : '');
}

/** Whether the pattern contains glob syntax (i.e. is not a literal path). */
export function isDynamicPattern(pattern, options = {}) {
  if (options.caseSensitiveMatch === false) {
    return true;
  }
  const str = String(pattern);
  return hasMagic(str) || expandBraces(str).length > 1;
}

/** Escape glob syntax in a filesystem path so it matches literally. */
export function convertPathToPattern(source) {
  const str = String(source);
  if (IS_WIN) {
    return str.replace(/\\/g, '/').replace(/[()[\]{}]|^!|[!+@](?=\()/g, '\\$&');
  }
  return str.replace(/[\\*?|()[\]{}]|^!|[!+@](?=\()/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Ignore files (.gitignore semantics)
// ---------------------------------------------------------------------------

function parseIgnoreLine(raw, base) {
  let line = raw.replace(/(?<!\\)\s+$/, '');
  if (!line || line.startsWith('#')) {
    return null;
  }
  const negate = line.startsWith('!');
  if (negate || line.startsWith('\\!') || line.startsWith('\\#')) {
    line = line.slice(1);
  }
  const dirOnly = line.endsWith('/');
  line = line.replace(/\/+$/, '');
  if (!line) {
    return null;
  }
  const anchored = line.includes('/');
  const rel = anchored ? line.replace(/^\/+/, '') : `**/${line}`;
  return expandBraces(base ? `${base}/${rel}` : rel).map((p) => ({
    negate,
    dirOnly,
    m: compileMatcher(p, { dot: true }),
  }));
}

function parseIgnoreFile(content, relDir) {
  const base = relDir === '.' ? '' : relDir;
  return String(content)
    .split(/\r?\n/)
    .flatMap((line) => parseIgnoreLine(line, base) || []);
}

/** Build a predicate `(path, isDir) => boolean` from ignore rules. */
function makeIgnoreFilter(rules, cwd) {
  const evaluate = (parts, isDir) => {
    let ignored = false;
    for (const r of rules) {
      if (
        r.negate === ignored &&
        (!r.dirOnly || isDir) &&
        matchFull(r.m, parts)
      ) {
        ignored = !r.negate;
      }
    }
    return ignored;
  };
  const toParts = (p) => {
    const rel = toPosix(path.relative(cwd, path.resolve(cwd, String(p))));
    if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) {
      return null;
    }
    return rel.split('/');
  };
  // `deep` also checks ancestors: a file inside an ignored dir is ignored.
  const deep = (p, isDir) => {
    const parts = toParts(p);
    return Boolean(
      parts &&
      parts.some((_, k) =>
        evaluate(parts.slice(0, k + 1), k < parts.length - 1 || isDir)
      )
    );
  };
  const direct = (p, isDir) => {
    const parts = toParts(p);
    return Boolean(parts && evaluate(parts, isDir));
  };
  return { deep, direct };
}

function* loadIgnoreFilterOp(patterns, options) {
  const cwd = path.resolve(toPath(options.cwd) || process.cwd());
  const files = [];
  const findOpts = {
    cwd,
    dot: true,
    ignore: DEFAULT_IGNORE_FILES_IGNORE,
    suppressErrors: options.suppressErrors,
    deep: options.deep,
    followSymbolicLinks: options.followSymbolicLinks,
  };
  yield* runGlobOp(patterns, findOpts, (file) => {
    files.push(file);
  });
  files.sort((a, b) => a.split('/').length - b.split('/').length);
  const rules = [];
  for (const file of files) {
    const content = yield ['readFile', path.resolve(cwd, file), 'utf8'];
    rules.push(...parseIgnoreFile(content, path.posix.dirname(file)));
  }
  return makeIgnoreFilter(rules, cwd);
}

// ---------------------------------------------------------------------------
// Options & tasks
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  dot: false,
  absolute: false,
  onlyFiles: true,
  onlyDirectories: false,
  markDirectories: false,
  deep: Infinity,
  followSymbolicLinks: true,
  unique: true,
  caseSensitiveMatch: true,
  objectMode: false,
  stats: false,
  baseNameMatch: false,
  expandDirectories: true,
  gitignore: false,
  suppressErrors: false,
  throwErrorOnBrokenSymbolicLink: false,
  extglob: true,
  braceExpansion: true,
};

function normalizeOptions(options = {}) {
  const defined = Object.fromEntries(
    Object.entries(options || {}).filter(([, v]) => v !== undefined)
  );
  const opts = { ...DEFAULT_OPTIONS, ...defined };
  opts.cwd = path.resolve(toPath(opts.cwd) || process.cwd());
  if (opts.onlyDirectories) {
    opts.onlyFiles = false;
  }
  opts.objectMode = Boolean(opts.objectMode || opts.stats);
  opts.nocase = opts.caseSensitiveMatch === false;
  opts.ignore = toArray(opts.ignore);
  return opts;
}

function assertPatterns(patterns) {
  const list = toArray(patterns);
  if (!list.every((p) => typeof p === 'string')) {
    throw new TypeError('Patterns must be a string or an array of strings');
  }
  return list;
}

function isNegative(pattern) {
  return pattern.startsWith('!') && pattern[1] !== '(';
}

function stripDotSlash(pattern) {
  let p = pattern;
  while (p.startsWith('./') && p.length > 2) {
    p = p.slice(2);
  }
  return p;
}

/** Group positive patterns with the negative patterns that follow them. */
function groupPatterns(patterns, opts) {
  const tasks = [];
  let current = null;
  patterns.forEach((pattern, index) => {
    if (isNegative(pattern)) {
      current = null;
      return;
    }
    if (!current) {
      const negatives = patterns
        .slice(index)
        .filter(isNegative)
        .map((p) => p.slice(1));
      current = { patterns: [], ignore: [...opts.ignore, ...negatives] };
      tasks.push(current);
    }
    current.patterns.push(pattern);
  });
  return tasks;
}

function directoryExpansion(dir, expand) {
  if (expand === true) {
    return [`${dir}/**`];
  }
  const files = Array.isArray(expand) ? expand : toArray(expand.files);
  const exts = Array.isArray(expand) ? [] : toArray(expand.extensions);
  const extGlob = exts.length > 1 ? `{${exts.join(',')}}` : exts[0];
  if (files.length === 0) {
    return [extGlob ? `${dir}/**/*.${extGlob}` : `${dir}/**`];
  }
  return files.map((f) =>
    extGlob && !path.extname(f) ? `${dir}/**/${f}.${extGlob}` : `${dir}/**/${f}`
  );
}

function* expandPatternOp(pattern, opts) {
  let p = pattern;
  if (opts.expandDirectories && !isDynamicPattern(p)) {
    const dir = p.replace(/(.)\/+$/, '$1');
    const st = yield* statMaybe(path.resolve(opts.cwd, unescapeGlob(dir)));
    if (st && st.isDirectory()) {
      return directoryExpansion(dir, opts.expandDirectories);
    }
  }
  if (opts.baseNameMatch && !p.includes('/')) {
    p = `**/${p}`;
  }
  return [p];
}

function* generateTasksOp(patterns, options) {
  const opts = normalizeOptions(options);
  const list = assertPatterns(patterns);
  const tasks = [];
  for (const group of groupPatterns(list, opts)) {
    const expanded = [];
    for (const pattern of group.patterns) {
      expanded.push(...(yield* expandPatternOp(pattern, opts)));
    }
    tasks.push({
      patterns: expanded,
      options: { ...opts, ignore: group.ignore },
    });
  }
  return tasks;
}

function expandAll(patterns, opts) {
  return patterns.flatMap((p) => (opts.braceExpansion ? expandBraces(p) : [p]));
}

function compileAll(patterns, opts) {
  return expandAll(patterns, opts)
    .map(stripDotSlash)
    .filter((p) => p !== '');
}

/** Split compiled patterns into walk roots (static base directories). */
function buildWalkGroups(patterns, opts) {
  const groups = new Map();
  for (const raw of expandAll(patterns, opts)) {
    // Like fast-glob, a leading `./` is kept in the results.
    const prefix = raw.startsWith('./') ? './' : '';
    const pattern = stripDotSlash(raw);
    if (pattern === '' || pattern === '.') {
      continue;
    }
    const parts = splitPattern(pattern.replace(/(.)\/+$/, '$1'));
    let i = 0;
    while (i < parts.length - 1 && !hasMagic(parts[i]) && parts[i] !== '**') {
      i++;
    }
    const baseParts = parts.slice(0, i).map(unescapeGlob);
    const key = prefix + baseParts.join('/');
    if (!groups.has(key)) {
      groups.set(key, { baseParts, prefix, matchers: [] });
    }
    groups.get(key).matchers.push(compileMatcher(pattern, opts));
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

function* readDirOp(abs, opts) {
  try {
    const list = yield ['readdir', abs, { withFileTypes: true }];
    return list.sort(byName);
  } catch (err) {
    if (opts.suppressErrors || IGNORED_READDIR_ERRORS.has(err.code)) {
      return [];
    }
    throw err;
  }
}

function* inspectOp(dir, dirent, opts) {
  const abs = path.join(dir.abs, dirent.name);
  const isLink = dirent.isSymbolicLink();
  let isDir = dirent.isDirectory();
  let isFile = dirent.isFile();
  let stats;
  if (isLink && opts.followSymbolicLinks) {
    stats = yield* statMaybe(abs);
    if (stats) {
      isDir = stats.isDirectory();
      isFile = stats.isFile();
    } else if (opts.throwErrorOnBrokenSymbolicLink) {
      yield ['stat', abs];
    }
  }
  if (opts.stats && !stats) {
    stats = yield [opts.followSymbolicLinks ? 'stat' : 'lstat', abs];
  }
  const parts = [...dir.parts, dirent.name];
  const depth = dir.depth + 1;
  return { abs, dirent, isLink, isDir, isFile, stats, parts, depth };
}

function isExcluded(entry, ctx) {
  if (ctx.ignores.some((m) => matchFull(m, entry.parts))) {
    return true;
  }
  return Boolean(ctx.filter && ctx.filter.direct(entry.abs, entry.isDir));
}

function entryMatches(entry, group, ctx) {
  const { opts } = ctx;
  if (entry.depth > opts.deep) {
    return false;
  }
  if (
    (opts.onlyFiles && !entry.isFile) ||
    (opts.onlyDirectories && !entry.isDir)
  ) {
    return false;
  }
  const matched = group.matchers.some(
    (m) => (!m.dirOnly || entry.isDir) && matchFull(m, entry.parts)
  );
  return matched && !isExcluded(entry, ctx);
}

function* shouldDescendOp(entry, dir, group, ctx) {
  const { opts } = ctx;
  if (!entry.isDir || entry.depth >= opts.deep) {
    return false;
  }
  if (!group.matchers.some((m) => matchPartial(m, entry.parts))) {
    return false;
  }
  if (isExcluded(entry, ctx)) {
    return false;
  }
  if (!entry.isLink) {
    return true;
  }
  // Avoid infinite loops through symlinks pointing to an ancestor.
  const target = yield ['realpath', entry.abs];
  const parent = yield ['realpath', dir.abs];
  return parent !== target && !parent.startsWith(target + path.sep);
}

function formatEntry(entry, opts, prefix) {
  const rel = entry.parts.join('/');
  let p = opts.absolute ? toPosix(path.resolve(opts.cwd, rel)) : prefix + rel;
  if (opts.markDirectories && entry.isDir) {
    p += '/';
  }
  if (!opts.objectMode) {
    return p;
  }
  const obj = { name: entry.dirent.name, path: p, dirent: entry.dirent };
  if (opts.stats) {
    obj.stats = entry.stats;
  }
  return obj;
}

function baseAbsPath(baseParts, cwd) {
  return path.resolve(cwd, baseParts.length ? `${baseParts.join('/')}/` : '.');
}

function* walkGroupOp(group, ctx) {
  const root = baseAbsPath(group.baseParts, ctx.opts.cwd);
  if (ctx.filter && ctx.filter.deep(root, true)) {
    return;
  }
  const queue = [{ abs: root, parts: group.baseParts, depth: 0 }];
  while (queue.length > 0) {
    const dir = queue.shift();
    for (const dirent of yield* readDirOp(dir.abs, ctx.opts)) {
      const entry = yield* inspectOp(dir, dirent, ctx.opts);
      if (entryMatches(entry, group, ctx)) {
        yield ['call', ctx.emit, entry, group.prefix];
      }
      if (yield* shouldDescendOp(entry, dir, group, ctx)) {
        queue.push(entry);
      }
    }
  }
}

/** Generator running a full glob; `onEntry` receives each result. */
function* runGlobOp(patterns, options, onEntry) {
  const tasks = yield* generateTasksOp(patterns, options);
  if (tasks.length === 0) {
    return;
  }
  const opts = tasks[0].options;
  const ignoreFiles = [
    ...(opts.gitignore ? ['**/.gitignore'] : []),
    ...toArray(opts.ignoreFiles),
  ];
  const filter =
    ignoreFiles.length > 0
      ? yield* loadIgnoreFilterOp(ignoreFiles, opts)
      : null;
  const seen = new Set();
  const emit = (entry, prefix) => {
    const result = formatEntry(entry, opts, prefix);
    const key = entry.parts.join('/');
    if (opts.unique && seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    return onEntry(result);
  };
  for (const task of tasks) {
    const ignores = compileAll(task.options.ignore, opts).map((p) =>
      compileMatcher(p, opts)
    );
    const ctx = { opts, filter, ignores, emit };
    for (const group of buildWalkGroups(task.patterns, opts)) {
      yield* walkGroupOp(group, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function collect(patterns, options, isAsync) {
  const results = [];
  const done = drive(
    runGlobOp(patterns, options, (entry) => {
      results.push(entry);
    }),
    isAsync
  );
  return isAsync ? done.then(() => results) : results;
}

/**
 * Find files and directories matching glob patterns.
 * @param {string|string[]} patterns
 * @param {object} [options]
 * @returns {Promise<Array<string|object>>}
 */
export function globby(patterns, options) {
  try {
    return collect(patterns, options, true);
  } catch (err) {
    return Promise.reject(err);
  }
}

/** Synchronous variant of {@link globby}. */
export function globbySync(patterns, options) {
  return collect(patterns, options, false);
}

/**
 * Stream variant of {@link globby}: returns an object-mode Readable that is
 * also async-iterable.
 */
export function globbyStream(patterns, options) {
  let resume = null;
  const stream = new Readable({
    objectMode: true,
    read() {
      if (resume) {
        const r = resume;
        resume = null;
        r();
      }
    },
  });
  const onEntry = (entry) => {
    if (!stream.push(entry)) {
      return new Promise((resolve) => {
        resume = resolve;
      });
    }
    return undefined;
  };
  drive(runGlobOp(patterns, options, onEntry), true).then(
    () => stream.push(null),
    (err) => stream.destroy(err)
  );
  return stream;
}

function publicTasks(tasks) {
  return tasks.map(({ patterns, options }) => ({ patterns, options }));
}

/** Split patterns into glob tasks: `[{patterns, options}]`. */
export function generateGlobTasks(patterns, options) {
  return drive(generateTasksOp(patterns, options), true).then(publicTasks);
}

/** Synchronous variant of {@link generateGlobTasks}. */
export function generateGlobTasksSync(patterns, options) {
  return publicTasks(drive(generateTasksOp(patterns, options), false));
}

function ignorePredicate(filter) {
  return (p) => filter.deep(toPath(p), String(p).endsWith('/'));
}

/** Resolve to a predicate telling whether a path is ignored by the files. */
export function isIgnoredByIgnoreFiles(patterns, options = {}) {
  return drive(loadIgnoreFilterOp(toArray(patterns), options), true).then(
    ignorePredicate
  );
}

/** Synchronous variant of {@link isIgnoredByIgnoreFiles}. */
export function isIgnoredByIgnoreFilesSync(patterns, options = {}) {
  return ignorePredicate(
    drive(loadIgnoreFilterOp(toArray(patterns), options), false)
  );
}

/** Resolve to a predicate telling whether a path is git-ignored. */
export function isGitIgnored(options = {}) {
  return isIgnoredByIgnoreFiles('**/.gitignore', options);
}

/** Synchronous variant of {@link isGitIgnored}. */
export function isGitIgnoredSync(options = {}) {
  return isIgnoredByIgnoreFilesSync('**/.gitignore', options);
}

export const glob = Object.assign(
  (patterns, options) => globby(patterns, options),
  {
    globby,
    sync: globbySync,
    globbySync,
    globbyStream,
    stream: globbyStream,
    generateGlobTasks,
    generateGlobTasksSync,
    isDynamicPattern,
    isGitIgnored,
    isGitIgnoredSync,
    isIgnoredByIgnoreFiles,
    isIgnoredByIgnoreFilesSync,
    convertPathToPattern,
    globToRegExp,
  }
);

export { globbySync as sync };

export default glob;
