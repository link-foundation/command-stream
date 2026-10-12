// Glob matching and directory walking, ported from Bun v1.4.2
// (src/glob/matcher.rs and src/glob/GlobWalker.rs, commit 09bb5463) with the
// option handling of src/runtime/api/glob.rs (`Bun.Glob#scanSync`).
//
// The matcher works on UTF-8 bytes exactly like the Rust original, so
// non-ASCII patterns and paths behave the same (lone surrogates become
// U+FFFD, as they do when Bun converts a JS string to UTF-8). The walker
// reads directories in raw OS order and yields paths in the same order as
// `Bun.Glob#scanSync`. Only POSIX semantics are ported (`/` is the only
// separator); Bun's Windows-specific paths are not.
//
// The matcher is derived from works under the MIT License:
// Copyright (c) 2023 Devon Govett, (c) 2023 Stephen Gregoratto,
// (c) 2024 shulaoda.

import fs from './fs.mjs';
import os from 'node:os';
import nodePath from 'node:path';
import util from 'node:util';

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const SLASH = 0x2f;
const STAR = 0x2a;
const QUESTION = 0x3f;
const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const COMMA = 0x2c;
const BANG = 0x21;
const CARET = 0x5e;
const DASH = 0x2d;
const DOT = 0x2e;

const REPLACEMENT_CHAR = 0xfffd;
const MAX_BRACE_DEPTH = 10;
const BRACE_BRANCH_BUDGET = 10000;

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  return Buffer.from(String(value), 'utf8');
}

/** strings::wtf8_byte_sequence_length */
function seqLen(b) {
  if (b <= 0x7f) {
    return 1;
  }
  if (b >= 0xc0 && b <= 0xdf) {
    return 2;
  }
  if (b >= 0xe0 && b <= 0xef) {
    return 3;
  }
  if (b >= 0xf0 && b <= 0xf7) {
    return 4;
  }
  return 1;
}

function isCont(b) {
  return (b & 0xc0) === 0x80;
}

/** strings::decode_wtf8_rune_t_multibyte over a zero-padded 4-byte window. */
function decodeMultibyte(p0, p1, p2, p3, len) {
  if (!isCont(p1)) {
    return REPLACEMENT_CHAR;
  }
  if (len === 2) {
    const cp = ((p0 & 0x1f) << 6) | (p1 & 0x3f);
    return cp < 0x80 ? REPLACEMENT_CHAR : cp;
  }
  if (!isCont(p2)) {
    return REPLACEMENT_CHAR;
  }
  if (len === 3) {
    const cp = ((p0 & 0x0f) << 12) | ((p1 & 0x3f) << 6) | (p2 & 0x3f);
    return cp < 0x800 ? REPLACEMENT_CHAR : cp;
  }
  if (!isCont(p3)) {
    return REPLACEMENT_CHAR;
  }
  const cp =
    ((p0 & 0x07) << 18) |
    ((p1 & 0x3f) << 12) |
    ((p2 & 0x3f) << 6) |
    (p3 & 0x3f);
  return cp < 0x10000 || cp > 0x10ffff ? REPLACEMENT_CHAR : cp;
}

/** matcher.rs decode_wtf8_rune_at: returns [codepoint, byteLength]. */
function decodeRuneAt(bytes, idx) {
  const len = seqLen(bytes[idx]);
  if (len === 1) {
    return [bytes[idx], 1];
  }
  const at = (i) => (idx + i < bytes.length ? bytes[idx + i] : 0);
  return [decodeMultibyte(bytes[idx], at(1), at(2), at(3), len), len];
}

function unescapeByte(b) {
  switch (b) {
    case 0x61: // a
      return 0x61;
    case 0x62: // b
      return 0x08;
    case 0x6e: // n
      return 0x0a;
    case 0x72: // r
      return 0x0d;
    case 0x74: // t
      return 0x09;
    default:
      return b;
  }
}

// ---------------------------------------------------------------------------
// Matcher (matcher.rs)
// ---------------------------------------------------------------------------

// Step outcomes of one iteration of glob_match_impl's main loop.
const CONTINUE = 0; // `continue 'main_loop`
const MISMATCH = 1; // fall through to the backtracking check
const TO_ELSE = 2; // run the literal-character branch
const FAIL = 3; // `return false`
const SUCCESS = 4; // `return true`

function newState() {
  // `w*` is the wildcard backtrack point, `s*` the globstar one.
  return {
    pi: 0,
    gi: 0,
    bd: 0,
    wGi: 0,
    wPi: 0,
    wBd: 0,
    sGi: 0,
    sPi: 0,
    sBd: 0,
  };
}

function restoreGlobstar(s) {
  s.wGi = s.sGi;
  s.wPi = s.sPi;
  s.wBd = s.sBd;
}

function skipToSeparator(s, path, isEndInvalid) {
  if (s.pi === path.length) {
    s.wPi += 1;
    return;
  }
  let pi = s.pi;
  while (pi < path.length && path[pi] !== SLASH) {
    pi += 1;
  }
  if (isEndInvalid || pi !== path.length) {
    pi += 1;
  }
  s.wPi = pi;
  s.sGi = s.wGi;
  s.sPi = s.wPi;
  s.sBd = s.wBd;
}

function skipGlobstars(glob, gi) {
  let i = gi + 2;
  while (
    i + 4 <= glob.length &&
    glob[i] === SLASH &&
    glob[i + 1] === STAR &&
    glob[i + 2] === STAR &&
    glob[i + 3] === SLASH
  ) {
    i += 3;
  }
  if (
    i + 3 === glob.length &&
    glob[i] === SLASH &&
    glob[i + 1] === STAR &&
    glob[i + 2] === STAR
  ) {
    i += 3;
  }
  return i - 2;
}

/** The `**` half of the `*` arm; returns true when now inside a globstar. */
function enterGlobstar(s, glob, globStart, path) {
  s.gi += 2;
  const isEndInvalid = s.gi < glob.length;
  if (
    isEndInvalid &&
    s.pi === path.length &&
    glob.length - s.gi === 2 &&
    glob[s.gi] === SLASH &&
    glob[s.gi + 1] === STAR
  ) {
    return null;
  }
  const atSegmentStart =
    Math.max(0, s.gi - globStart) < 3 || glob[s.gi - 3] === SLASH;
  if (atSegmentStart && (!isEndInvalid || glob[s.gi] === SLASH)) {
    if (isEndInvalid) {
      s.gi += 1;
    }
    skipToSeparator(s, path, isEndInvalid);
    return true;
  }
  return false;
}

function stepStar(s, glob, globStart, path) {
  const isGlobstar = s.gi + 1 < glob.length && glob[s.gi + 1] === STAR;
  if (isGlobstar) {
    s.gi = skipGlobstars(glob, s.gi);
  }
  s.wGi = s.gi;
  s.wPi = s.pi + (s.pi < path.length ? seqLen(path[s.pi]) : 1);
  s.wBd = s.bd;
  let inGlobstar = false;
  if (isGlobstar) {
    inGlobstar = enterGlobstar(s, glob, globStart, path);
    if (inGlobstar === null) {
      return CONTINUE;
    }
  } else {
    s.gi += 1;
  }
  if (!inGlobstar && s.pi < path.length && path[s.pi] === SLASH) {
    restoreGlobstar(s);
  }
  return CONTINUE;
}

function stepQuestion(s, path) {
  if (s.pi >= path.length) {
    return TO_ELSE;
  }
  if (path[s.pi] === SLASH) {
    return MISMATCH;
  }
  s.gi += 1;
  s.pi += seqLen(path[s.pi]);
  return CONTINUE;
}

/** matcher.rs get_unicode: returns [codepoint, byteLength] or null. */
function getUnicode(s, glob) {
  const c = glob[s.gi];
  if (c <= 0x7f && c !== BACKSLASH) {
    return [c, 1];
  }
  if (c === BACKSLASH) {
    s.gi += 1;
    if (s.gi >= glob.length) {
      return null;
    }
    const e = glob[s.gi];
    if (e === 0x61 || e === 0x62 || e === 0x6e || e === 0x72 || e === 0x74) {
      return [unescapeByte(e), 1];
    }
  }
  return decodeRuneAt(glob, s.gi);
}

/** Scans one `[...]` class; returns [isMatch] or null when invalid. */
function scanClass(s, glob, c) {
  let first = true;
  let isMatch = false;
  while (s.gi < glob.length && (first || glob[s.gi] !== CLOSE_BRACKET)) {
    const low = getUnicode(s, glob);
    if (low === null) {
      return null;
    }
    s.gi += low[1];
    let high = low[0];
    if (
      s.gi + 1 < glob.length &&
      glob[s.gi] === DASH &&
      glob[s.gi + 1] !== CLOSE_BRACKET
    ) {
      s.gi += 1;
      const h = getUnicode(s, glob);
      if (h === null) {
        return null;
      }
      s.gi += h[1];
      high = h[0];
    }
    if (low[0] <= c && c <= high) {
      isMatch = true;
    }
    first = false;
  }
  return [isMatch];
}

function stepBracket(s, glob, path) {
  if (s.pi >= path.length) {
    return TO_ELSE;
  }
  s.gi += 1;
  let negated = false;
  if (s.gi < glob.length && (glob[s.gi] === CARET || glob[s.gi] === BANG)) {
    negated = true;
    s.gi += 1;
  }
  const [c, len] = decodeRuneAt(path, s.pi);
  const scanned = scanClass(s, glob, c);
  if (scanned === null || s.gi >= glob.length) {
    return FAIL;
  }
  s.gi += 1;
  if (scanned[0] !== negated) {
    s.pi += len;
    return CONTINUE;
  }
  return MISMATCH;
}

function stepLiteral(s, glob, path, ch) {
  if (s.pi >= path.length) {
    return MISMATCH;
  }
  let cc = ch;
  if (cc === BACKSLASH) {
    s.gi += 1;
    if (s.gi >= glob.length) {
      return FAIL;
    }
    cc = unescapeByte(glob[s.gi]);
  }
  const ccLen = seqLen(cc);
  let isMatch;
  if (cc === SLASH) {
    isMatch = path[s.pi] === SLASH;
  } else if (ccLen > 1) {
    isMatch =
      s.pi + ccLen <= path.length &&
      s.gi + ccLen <= glob.length &&
      bytesEqual(path, s.pi, glob, s.gi, ccLen);
  } else {
    isMatch = path[s.pi] === cc;
  }
  if (!isMatch) {
    return MISMATCH;
  }
  s.gi += ccLen;
  s.pi += ccLen;
  if (cc === SLASH) {
    restoreGlobstar(s);
  }
  return CONTINUE;
}

function bytesEqual(a, ai, b, bi, n) {
  for (let k = 0; k < n; k++) {
    if (a[ai + k] !== b[bi + k]) {
      return false;
    }
  }
  return true;
}

function stepOpenBrace(s, glob, path, ctx) {
  for (const brace of ctx.stack) {
    if (brace.open === s.gi) {
      s.gi = brace.branch;
      s.bd = (s.bd + 1) & 0xff;
      return CONTINUE;
    }
  }
  return matchBrace(s, glob, path, ctx) ? SUCCESS : FAIL;
}

function stepGlob(s, glob, globStart, path, ctx) {
  const ch = glob[s.gi];
  let r = TO_ELSE;
  switch (ch) {
    case STAR:
      return stepStar(s, glob, globStart, path);
    case QUESTION:
      r = stepQuestion(s, path);
      break;
    case OPEN_BRACKET:
      r = stepBracket(s, glob, path);
      break;
    case OPEN_BRACE:
      return stepOpenBrace(s, glob, path, ctx);
    case COMMA:
    case CLOSE_BRACE:
      if (s.bd > 0 && skipBranch(s, glob, ctx.stack)) {
        return CONTINUE;
      }
      break;
    default:
      break;
  }
  if (r !== TO_ELSE) {
    return r;
  }
  return stepLiteral(s, glob, path, ch);
}

function globMatchImpl(s, glob, globStart, path, ctx) {
  while (s.gi < glob.length || s.pi < path.length) {
    if (s.gi < glob.length) {
      const r = stepGlob(s, glob, globStart, path, ctx);
      if (r === CONTINUE) {
        continue;
      }
      if (r === FAIL) {
        return false;
      }
      if (r === SUCCESS) {
        return true;
      }
    }
    if (s.wPi > 0 && s.wPi <= path.length) {
      s.pi = s.wPi;
      s.gi = s.wGi;
      s.bd = s.wBd;
      continue;
    }
    return false;
  }
  return true;
}

function findBraceEnd(glob, openIdx) {
  let depth = 0;
  let inBrackets = false;
  for (let i = openIdx; i < glob.length; i++) {
    const c = glob[i];
    if (c === OPEN_BRACE && !inBrackets) {
      depth += 1;
    } else if (c === CLOSE_BRACE && !inBrackets) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    } else if (c === OPEN_BRACKET && !inBrackets) {
      inBrackets = true;
    } else if (c === CLOSE_BRACKET) {
      inBrackets = false;
    } else if (c === BACKSLASH) {
      i += 1;
    }
  }
  return glob.length;
}

function matchBrace(s, glob, path, ctx) {
  let depth = 0;
  let inBrackets = false;
  const open = s.gi;
  const close = findBraceEnd(glob, open);
  let branch = 0;
  for (; s.gi < glob.length; s.gi++) {
    const c = glob[s.gi];
    if (c === OPEN_BRACE && !inBrackets) {
      depth += 1;
      if (depth === 1) {
        branch = s.gi + 1;
      }
    } else if (c === CLOSE_BRACE && !inBrackets) {
      depth -= 1;
      if (depth === 0) {
        return matchBraceBranch(s, glob, path, [open, branch, close], ctx);
      }
    } else if (c === COMMA && depth === 1 && !inBrackets) {
      if (matchBraceBranch(s, glob, path, [open, branch, close], ctx)) {
        return true;
      }
      branch = s.gi + 1;
    } else if (c === OPEN_BRACKET) {
      inBrackets = true;
    } else if (c === CLOSE_BRACKET) {
      inBrackets = false;
    } else if (c === BACKSLASH) {
      s.gi += 1;
    }
  }
  return false;
}

function matchBraceBranch(s, glob, path, [open, branch, close], ctx) {
  if (ctx.budget === 0) {
    return false;
  }
  ctx.budget -= 1;
  if (ctx.stack.length >= MAX_BRACE_DEPTH) {
    return false;
  }
  ctx.stack.push({ open, branch, close });
  const branchState = { ...s, gi: branch, bd: ctx.stack.length };
  const matched = globMatchImpl(branchState, glob, branch, path, ctx);
  ctx.stack.pop();
  return matched;
}

function skipBranch(s, glob, stack) {
  const gi = s.gi;
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k];
    if (frame.open < gi && gi <= frame.close) {
      if (frame.close < glob.length) {
        s.gi = frame.close + 1;
        s.bd -= 1;
      } else {
        s.gi = frame.close;
      }
      return true;
    }
  }
  return false;
}

function matchBytes(glob, path) {
  const s = newState();
  let negated = false;
  while (s.gi < glob.length && glob[s.gi] === BANG) {
    negated = !negated;
    s.gi += 1;
  }
  const ctx = { stack: [], budget: BRACE_BRANCH_BUDGET };
  const matched = globMatchImpl(s, glob, s.gi, path, ctx);
  return { matches: matched !== negated, negated };
}

/**
 * Returns whether `path` matches the glob `pattern`, exactly like Bun's
 * `new Bun.Glob(pattern).match(path)`. Both arguments are strings (or
 * UTF-8 byte arrays).
 */
export function globMatch(pattern, path) {
  return matchBytes(toBytes(pattern), toBytes(path)).matches;
}

/**
 * Port of glob/lib.rs detect_glob_syntax: true when `pattern` contains an
 * unescaped `*`, `{`, `[` or `?`, or starts with `!`.
 */
export function hasGlobSyntax(pattern) {
  const str = String(pattern);
  if (str.startsWith('!')) {
    return true;
  }
  for (const token of '*{[?') {
    let from = 0;
    let idx;
    while ((idx = str.indexOf(token, from)) !== -1) {
      let i = idx;
      let escaped = false;
      while (i > from && str[i - 1] === '\\') {
        escaped = !escaped;
        i -= 1;
      }
      if (!escaped) {
        return true;
      }
      from = idx + 1;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pattern components (GlobWalker.rs)
// ---------------------------------------------------------------------------

const HINT_NONE = 0;
const HINT_SINGLE = 1;
const HINT_DOUBLE = 2;
const HINT_WILDCARD_FILEPATH = 3;
const HINT_LITERAL = 4;
const HINT_DOT = 5;
const HINT_DOT_BACK = 6;

function hasSpecialSyntax(bytes, start, end) {
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (
      c === STAR ||
      c === OPEN_BRACKET ||
      c === OPEN_BRACE ||
      c === QUESTION ||
      c === BANG
    ) {
      return true;
    }
  }
  return false;
}

function isWildcardFilepath(bytes, start, len) {
  if (
    !(len > 1 && bytes[start] === STAR && bytes[start + 1] === DOT) ||
    start + 2 >= bytes.length
  ) {
    return false;
  }
  for (let i = start + 2; i < bytes.length; i++) {
    const c = bytes[i];
    if (
      c === OPEN_BRACKET ||
      c === OPEN_BRACE ||
      c === QUESTION ||
      c === STAR
    ) {
      return false;
    }
  }
  return true;
}

function syntaxHint(bytes, start, len) {
  if (len === 1 && bytes[start] === DOT) {
    return HINT_DOT;
  }
  if (len === 2 && bytes[start] === DOT && bytes[start + 1] === DOT) {
    return HINT_DOT_BACK;
  }
  if (!hasSpecialSyntax(bytes, start, start + len)) {
    return HINT_LITERAL;
  }
  if (len === 1) {
    return bytes[start] === STAR ? HINT_SINGLE : HINT_NONE;
  }
  if (len === 2 && bytes[start] === STAR && bytes[start + 1] === STAR) {
    return HINT_DOUBLE;
  }
  return isWildcardFilepath(bytes, start, len)
    ? HINT_WILDCARD_FILEPATH
    : HINT_NONE;
}

function makeComponent(bytes, start, end) {
  const len = end - start;
  if (len === 0) {
    return null;
  }
  const hint = syntaxHint(bytes, start, len);
  const trailingSep = bytes[start + len - 1] === SLASH;
  const sliceBytes = bytes.subarray(start, end - (trailingSep ? 1 : 0));
  return {
    hint,
    trailingSep,
    sliceBytes,
    slice: Buffer.from(sliceBytes).toString('utf8'),
  };
}

function buildPatternComponents(bytes) {
  const comps = [];
  let endByte = 0;
  let baseIdx = 0;
  let start = 0;
  let sawSpecial = false;
  let width = 0;
  const record = (comp, end) => {
    if (comp !== null) {
      sawSpecial = sawSpecial || comp.hint !== HINT_LITERAL;
    }
    if (!sawSpecial) {
      baseIdx = comps.length;
      endByte = Math.min(end, bytes.length);
    }
    if (comp !== null) {
      comps.push(comp);
    }
  };
  let i = 0;
  for (; i < bytes.length; i++) {
    width = seqLen(bytes[i]);
    if (bytes[i] === SLASH) {
      const end = i + width === bytes.length ? i + width : i;
      const comp = makeComponent(bytes, start, end);
      if (comp !== null) {
        record(comp, i + width);
      }
      start = i + width;
    }
  }
  i = Math.max(0, i - 1);
  record(makeComponent(bytes, start, bytes.length), i + width);
  return { comps, endByte, baseIdx };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

let systemErrorMap = null;

function errorDescription(code, errno, cause) {
  if (systemErrorMap === null && typeof util.getSystemErrorMap === 'function') {
    systemErrorMap = util.getSystemErrorMap();
  }
  const entry =
    errno === undefined ? undefined : systemErrorMap?.get(-errno)?.[1];
  if (entry) {
    return entry;
  }
  const m = /^[A-Z0-9_]+: (.*?), /.exec(cause?.message ?? '');
  return m ? m[1] : code;
}

/** Builds a Bun-style SystemError: `code`, `path`, `syscall`, `errno`. */
function sysError(code, syscall, path, cause) {
  const errno = os.constants.errno[code];
  const err = new Error(
    `${code}: ${errorDescription(code, errno, cause)}, ${syscall} '${path}'`
  );
  err.code = code;
  err.path = path;
  err.syscall = syscall;
  err.errno = errno === undefined ? undefined : -errno;
  return err;
}

function rethrowAs(e, syscall, path) {
  if (e && typeof e.code === 'string' && /^E[A-Z0-9]+$/.test(e.code)) {
    return sysError(e.code, syscall, path, e);
  }
  return e;
}

// ---------------------------------------------------------------------------
// Walker (GlobWalker.rs)
// ---------------------------------------------------------------------------

const MAX_PATH_BYTES = process.platform === 'darwin' ? 1024 : 4096;
const KIND_DIRECTORY = 0;
const KIND_SYMLINK = 1;

function byteLength(str) {
  return Buffer.byteLength(str, 'utf8');
}

/** paths::join_sep_vec: non-normalizing join with `/`. */
function joinSep(parts) {
  let out = '';
  let prevLast = null;
  for (const p of parts) {
    if (p.length === 0) {
      continue;
    }
    if (prevLast === null) {
      out += p;
    } else {
      const prevSep = prevLast === '/';
      const thisSep = p[0] === '/';
      if (!prevSep && !thisSep) {
        out += '/';
      }
      out += prevSep && thisSep ? p.slice(1) : p;
    }
    prevLast = p[p.length - 1];
  }
  return out;
}

function joinPath(w, dir, name) {
  return w.absolute ? nodePath.posix.join(dir, name) : joinSep([dir, name]);
}

function toOsPath(w, p) {
  if (p.startsWith('/')) {
    return p;
  }
  if (p === '') {
    return w.rootOs;
  }
  return w.rootOs.endsWith('/') ? w.rootOs + p : `${w.rootOs}/${p}`;
}

/**
 * Opens a directory. The first entry is read eagerly because Bun's
 * `fs.opendirSync` defers some open errors (e.g. EACCES) to the first read,
 * while Bun's glob walker reports them from `open`.
 */
function openDir(w, osPath) {
  const dir = fs.opendirSync(osPath);
  const handle = { dir, peeked: undefined };
  w.openDirs.add(handle);
  try {
    handle.peeked = dir.readSync();
  } catch (e) {
    closeDir(w, handle);
    throw e;
  }
  return handle;
}

function readDirEntry(handle) {
  if (handle.peeked !== undefined) {
    const ent = handle.peeked;
    handle.peeked = ent === null ? null : undefined;
    return ent;
  }
  return handle.dir.readSync();
}

function closeDir(w, handle) {
  if (handle && w.openDirs.delete(handle)) {
    try {
      handle.dir.closeSync();
    } catch (_e) {
      // Closing is best effort, like close_allowing_bad_file_descriptor.
    }
  }
}

function matchPatternImpl(w, comp, name) {
  if (!w.dot && name.startsWith('.') && !comp.slice.startsWith('.')) {
    return false;
  }
  switch (comp.hint) {
    case HINT_DOUBLE:
    case HINT_SINGLE:
      return true;
    case HINT_WILDCARD_FILEPATH:
      return name.endsWith(comp.slice.slice(1));
    case HINT_LITERAL:
      return name === comp.slice;
    default:
      return matchBytes(comp.sliceBytes, toBytes(name)).matches;
  }
}

/** match_pattern_dir: returns the index bump, or -1 for "don't recurse". */
function matchPatternDir(w, idx, name, hidden, res) {
  const comps = w.comps;
  const isLast = idx === comps.length - 1;
  if (comps[idx].hint === HINT_DOUBLE) {
    if (!isLast && matchPatternImpl(w, comps[idx + 1], name)) {
      if (idx + 1 === comps.length - 1) {
        res.add = true;
        return hidden ? -1 : 0;
      }
      return 2;
    }
    if (hidden) {
      return -1;
    }
    if (isLast) {
      res.add = true;
    }
    return 0;
  }
  if (matchPatternImpl(w, comps[idx], name)) {
    if (isLast) {
      res.add = true;
      return -1;
    }
    return 1;
  }
  return -1;
}

function matchPatternFile(w, idx, name) {
  const comps = w.comps;
  const comp = comps[idx];
  if (comp.trailingSep) {
    return false;
  }
  if (idx !== comps.length - 1) {
    return (
      comp.hint === HINT_DOUBLE &&
      idx + 1 === comps.length - 1 &&
      comps[idx + 1].hint !== HINT_DOUBLE &&
      matchPatternImpl(w, comps[idx + 1], name)
    );
  }
  return matchPatternImpl(w, comp, name);
}

function normalizeIdx(w, idx) {
  let i = idx;
  if (i < w.comps.length && w.comps[i].hint === HINT_DOUBLE) {
    while (i + 1 < w.comps.length && w.comps[i + 1].hint === HINT_DOUBLE) {
      i += 1;
    }
  }
  return i;
}

function toSortedSet(indices) {
  return [...new Set(indices)].sort((a, b) => a - b);
}

function evalDir(w, active, name) {
  const res = { add: false, child: [] };
  const hidden = !w.dot && name.startsWith('.');
  const picked = [];
  for (const idx of active) {
    const bump = matchPatternDir(w, idx, name, hidden, res);
    if (bump < 0) {
      continue;
    }
    picked.push(normalizeIdx(w, idx + bump));
    if (bump === 2 && !hidden && w.comps[idx + 2].hint !== HINT_DOUBLE) {
      picked.push(idx);
    }
  }
  res.child = toSortedSet(picked);
  return res;
}

function evalFile(w, active, name) {
  return active.some((idx) => matchPatternFile(w, idx, name));
}

function evalImpl(w, active, name) {
  const comps = w.comps;
  return active.some(
    (idx) =>
      matchPatternImpl(w, comps[idx], name) ||
      (comps[idx].hint === HINT_DOUBLE &&
        idx + 1 < comps.length &&
        matchPatternImpl(w, comps[idx + 1], name))
  );
}

function evalLiteralSubset(w, active, name) {
  return active.filter(
    (idx) =>
      w.comps[idx].hint === HINT_LITERAL &&
      matchPatternImpl(w, w.comps[idx], name)
  );
}

/** skip_special_components: appends `.`/`..` to `dirPath`, collapses `**`. */
function skipSpecialComponents(w, idx, dirPath) {
  const comps = w.comps;
  let i = idx;
  let p = dirPath;
  let hadDotDot = false;
  while (i < comps.length) {
    const hint = comps[i].hint;
    if (hint !== HINT_DOT && hint !== HINT_DOT_BACK) {
      break;
    }
    const extra = hint === HINT_DOT ? 2 : 3;
    if (byteLength(p) + extra >= MAX_PATH_BYTES) {
      throw sysError('ENAMETOOLONG', 'open', p);
    }
    const seg = hint === HINT_DOT ? '.' : '..';
    hadDotDot = hadDotDot || hint === HINT_DOT_BACK;
    p = p === '' ? seg : `${p}/${seg}`;
    i += 1;
  }
  return { idx: normalizeIdx(w, i), dirPath: p, hadDotDot };
}

function addMatch(w, p) {
  w.matched.add(p);
}

function pushWorkItem(w, item, followedLink) {
  item.followedLen = w.followed.length;
  item.followedLink = followedLink;
  w.work.push(item);
}

/** Literal-tail optimization of transition_to_dir_iter_state. */
function statLiteralTail(w, fdOs, dirPath, comp) {
  if (comp.slice === '') {
    // fstatat(fd, "") fails with ENOENT, which Bun skips.
    return;
  }
  let st;
  try {
    st = fs.statSync(`${fdOs}/${comp.slice}`);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return;
    }
    throw rethrowAs(e, 'fstatat', comp.slice);
  }
  if (st.isFile() || !w.onlyFiles) {
    addMatch(w, joinPath(w, dirPath, comp.slice));
  }
}

/** transition_to_dir_iter_state: returns a directory to iterate, or null. */
function transition(w, item, root) {
  let dirPath = '';
  if (!(root && !w.absolute)) {
    if (byteLength(item.path) >= MAX_PATH_BYTES) {
      throw sysError('ENAMETOOLONG', 'open', item.path);
    }
    dirPath = item.path;
  }
  let active = item.active;
  let hadDotDot = false;
  if (active.length === 1) {
    const r = skipSpecialComponents(w, active[0], dirPath);
    if (r.idx >= w.comps.length) {
      closeDir(w, item.dir);
      return null;
    }
    ({ dirPath, hadDotDot } = r);
    active = [r.idx];
  }
  let dir = item.dir ?? null;
  let fdOs = item.dirOs;
  if (!dir && root && !hadDotDot) {
    dir = w.rootDir;
    fdOs = w.rootOs;
  } else if (!dir) {
    fdOs = toOsPath(w, dirPath);
    try {
      dir = openDir(w, fdOs);
    } catch (e) {
      throw rethrowAs(e, 'open', dirPath);
    }
  }
  const lastIdx = w.comps.length - 1;
  if (
    active.length === 1 &&
    active[0] === lastIdx &&
    w.comps[lastIdx].hint === HINT_LITERAL
  ) {
    if (dir !== w.rootDir) {
      closeDir(w, dir);
    }
    statLiteralTail(w, fdOs, dirPath, w.comps[lastIdx]);
    return null;
  }
  return { dir, fdOs, dirPath, active };
}

function followActiveFor(w, active, name, prefiltered) {
  if (w.followSymlinks) {
    return prefiltered || evalImpl(w, active, name) ? active : null;
  }
  const subset = evalLiteralSubset(w, active, name);
  return subset.length !== 0 ? subset : null;
}

function handleDirEntry(w, d, name) {
  const { child, add } = evalDir(w, d.active, name);
  if (child.length !== 0) {
    pushWorkItem(
      w,
      {
        path: joinPath(w, d.dirPath, name),
        active: child,
        kind: KIND_DIRECTORY,
      },
      null
    );
  }
  if (add && !w.onlyFiles) {
    addMatch(w, joinPath(w, d.dirPath, name));
  }
}

function handleSymlinkEntry(w, d, name, prefiltered) {
  const follow = followActiveFor(w, d.active, name, prefiltered);
  if (follow !== null) {
    const p = joinPath(w, d.dirPath, name);
    pushWorkItem(
      w,
      {
        path: p,
        active: follow,
        kind: KIND_SYMLINK,
        entryStart: p.length - name.length,
      },
      null
    );
    return;
  }
  if (!w.onlyFiles && evalFile(w, d.active, name)) {
    addMatch(w, joinPath(w, d.dirPath, name));
  }
}

function handleFileEntry(w, d, name) {
  if (evalFile(w, d.active, name)) {
    addMatch(w, joinPath(w, d.dirPath, name));
  }
}

function handleUnknownEntry(w, d, name) {
  if (!evalImpl(w, d.active, name)) {
    return;
  }
  let st;
  try {
    st = fs.lstatSync(`${d.fdOs}/${name}`);
  } catch (_e) {
    return;
  }
  if (st.isFile()) {
    handleFileEntry(w, d, name);
  } else if (st.isDirectory()) {
    handleDirEntry(w, d, name);
  } else if (st.isSymbolicLink()) {
    handleSymlinkEntry(w, d, name, true);
  }
}

function isUnknownDirent(ent) {
  return !(
    ent.isFIFO() ||
    ent.isSocket() ||
    ent.isBlockDevice() ||
    ent.isCharacterDevice()
  );
}

function processEntry(w, d, ent) {
  const name = ent.name;
  if (ent.isFile()) {
    handleFileEntry(w, d, name);
  } else if (ent.isDirectory()) {
    handleDirEntry(w, d, name);
  } else if (ent.isSymbolicLink()) {
    handleSymlinkEntry(w, d, name, false);
  } else if (isUnknownDirent(ent)) {
    handleUnknownEntry(w, d, name);
  }
}

function iterateDir(w, d) {
  try {
    for (;;) {
      let ent;
      try {
        ent = readDirEntry(d.dir);
      } catch (e) {
        throw rethrowAs(e, 'getdents64', d.dirPath);
      }
      if (ent === null) {
        return;
      }
      processEntry(w, d, ent);
    }
  } finally {
    if (d.dir !== w.rootDir) {
      closeDir(w, d.dir);
    }
  }
}

function statTarget(osPath) {
  try {
    const st = fs.statSync(osPath, { bigint: true });
    return { dev: st.dev, ino: st.ino };
  } catch (_e) {
    return null;
  }
}

function resolvePendingFollowedLinks(w) {
  for (let i = 0; i < w.followed.length; i++) {
    const link = w.followed[i];
    if (link.pending !== undefined) {
      const target = statTarget(toOsPath(w, link.pending));
      if (target !== null) {
        w.followed[i] = target;
      }
    }
  }
}

function isFollowedLinkCycle(w, target) {
  return w.followed.some(
    (l) =>
      l.pending === undefined && l.dev === target.dev && l.ino === target.ino
  );
}

/** Decides whether to descend into a followed symlinked directory. */
function followedLinkFor(w, fullPath, osPath) {
  if (w.followed.length === 0) {
    return { descend: true, link: { pending: fullPath } };
  }
  const target = statTarget(osPath);
  if (target === null) {
    return { descend: true, link: null };
  }
  resolvePendingFollowedLinks(w);
  if (isFollowedLinkCycle(w, target)) {
    return { descend: false, link: null };
  }
  return { descend: true, link: target };
}

function openSymlinkTarget(w, fullPath, active, entryName) {
  const osPath = toOsPath(w, fullPath);
  try {
    return { dir: openDir(w, osPath), osPath };
  } catch (e) {
    if (e && e.code === 'ENOTDIR') {
      if (evalFile(w, active, entryName)) {
        addMatch(w, fullPath);
      }
      return null;
    }
    if (w.errorOnBrokenSymlinks) {
      throw rethrowAs(e, 'open', fullPath);
    }
    if (!w.onlyFiles && evalFile(w, active, entryName)) {
      addMatch(w, fullPath);
    }
    return null;
  }
}

/** The Symlink arm of Iterator::next. */
function processSymlinkItem(w, item) {
  if (byteLength(item.path) >= MAX_PATH_BYTES) {
    throw sysError('ENAMETOOLONG', 'open', item.path);
  }
  let fullPath = item.path;
  let active = item.active;
  if (active.length === 1) {
    const r = skipSpecialComponents(w, active[0], fullPath);
    if (r.idx >= w.comps.length) {
      return;
    }
    fullPath = r.dirPath;
    active = [r.idx];
  }
  const entryName = fullPath.slice(item.entryStart);
  const opened = openSymlinkTarget(w, fullPath, active, entryName);
  if (opened === null) {
    return;
  }
  const { child, add } = evalDir(w, active, entryName);
  const decision =
    child.length !== 0
      ? followedLinkFor(w, fullPath, opened.osPath)
      : { descend: false, link: null };
  if (decision.descend) {
    pushWorkItem(
      w,
      {
        path: item.path,
        active: child,
        kind: KIND_DIRECTORY,
        dir: opened.dir,
        dirOs: opened.osPath,
      },
      decision.link
    );
  } else {
    closeDir(w, opened.dir);
  }
  if (add && !w.onlyFiles) {
    addMatch(w, fullPath);
  }
}

/** Iterator::init: opens the root; returns the first directory or null. */
function initWalk(w, patternStr) {
  let rootPath = w.cwd;
  let startIdx = 0;
  const isAbsolute = patternStr.startsWith('/');
  if (isAbsolute) {
    rootPath = Buffer.from(w.patternBytes.subarray(0, w.endByte)).toString(
      'utf8'
    );
    startIdx = w.baseIdx;
    if (rootPath === '') {
      rootPath = '/';
    } else {
      startIdx += 1;
      if (startIdx >= w.comps.length) {
        // A pattern without glob syntax: Bun only probes the path and does
        // not add it to the results.
        probeLiteralPath(w, rootPath);
        return null;
      }
    }
  }
  if (byteLength(rootPath) >= MAX_PATH_BYTES) {
    throw sysError('ENAMETOOLONG', 'open', rootPath);
  }
  try {
    w.rootDir = openDir(w, rootPath);
  } catch (e) {
    throw rethrowAs(e, 'open', rootPath);
  }
  w.rootOs = rootPath;
  const root = { path: rootPath, active: [startIdx], kind: KIND_DIRECTORY };
  return transition(w, root, !isAbsolute);
}

function probeLiteralPath(w, p) {
  try {
    closeDir(w, openDir(w, p));
  } catch (e) {
    if (e && (e.code === 'ENOTDIR' || e.code === 'ENOENT')) {
      return;
    }
    throw rethrowAs(e, 'open', p);
  }
}

function runWalk(w, patternStr) {
  let dir = initWalk(w, patternStr);
  for (;;) {
    if (dir !== null) {
      iterateDir(w, dir);
      dir = null;
    }
    const item = w.work.pop();
    if (item === undefined) {
      return;
    }
    w.followed.length = item.followedLen;
    if (item.followedLink) {
      w.followed.push(item.followedLink);
    }
    if (item.kind === KIND_DIRECTORY) {
      dir = transition(w, item, false);
    } else {
      processSymlinkItem(w, item);
    }
  }
}

// ---------------------------------------------------------------------------
// Options (runtime/api/glob.rs ScanOpts)
// ---------------------------------------------------------------------------

/** Bun's option parsing: a present non-boolean value counts as `false`. */
function boolOption(opts, key, fallback) {
  const v = opts[key];
  if (v === undefined || v === null) {
    return fallback;
  }
  return typeof v === 'boolean' ? v : false;
}

function parseCwd(cwd, absolute, fnName) {
  if (byteLength(cwd) > MAX_PATH_BYTES) {
    throw new Error(
      `${fnName}: invalid \`cwd\`, longer than ${MAX_PATH_BYTES} bytes`
    );
  }
  if (cwd.startsWith('/')) {
    return cwd;
  }
  const result = absolute
    ? nodePath.posix.join(process.cwd(), cwd)
    : nodePath.posix.join(cwd);
  if (byteLength(result) > MAX_PATH_BYTES) {
    throw new Error(
      `${fnName}: invalid \`cwd\`, longer than ${MAX_PATH_BYTES} bytes`
    );
  }
  return result;
}

function parseOptions(options, fnName) {
  const out = {
    cwd: '',
    dot: false,
    absolute: false,
    followSymlinks: false,
    errorOnBrokenSymlinks: false,
    onlyFiles: true,
  };
  if (options === undefined || options === null) {
    return out;
  }
  if (typeof options === 'string') {
    out.cwd = options === '' ? '' : parseCwd(options, false, fnName);
    return out;
  }
  if (typeof options !== 'object') {
    throw new Error(`${fnName}: expected first argument to be an object`);
  }
  out.onlyFiles = boolOption(options, 'onlyFiles', true);
  out.errorOnBrokenSymlinks = boolOption(
    options,
    'throwErrorOnBrokenSymlink',
    false
  );
  out.followSymlinks = boolOption(options, 'followSymlinks', false);
  out.absolute = boolOption(options, 'absolute', false);
  const cwd = options.cwd;
  if (cwd !== undefined && cwd !== null) {
    if (typeof cwd !== 'string') {
      throw new Error(`${fnName}: invalid \`cwd\`, not a string`);
    }
    out.cwd = cwd === '' ? '' : parseCwd(cwd, out.absolute, fnName);
  }
  out.dot = boolOption(options, 'dot', false);
  return out;
}

/**
 * Walks the file system and returns the paths matching `pattern`, in the
 * same order as `new Bun.Glob(pattern).scanSync(options)`.
 *
 * Options: `cwd` (default `process.cwd()`), `dot` (false), `absolute`
 * (false), `followSymlinks` (false), `throwErrorOnBrokenSymlink` (false),
 * `onlyFiles` (true). A string is accepted in place of the options object as
 * the `cwd`. File system errors are thrown as Error objects carrying `code`,
 * `path`, `syscall` and a negative `errno`, like Bun's.
 */
export function globWalkSync(pattern, options) {
  const opts = parseOptions(options, 'globWalkSync');
  const patternStr = String(pattern);
  const patternBytes = toBytes(patternStr);
  const { comps, endByte, baseIdx } = buildPatternComponents(patternBytes);
  if (comps.length === 0) {
    return [];
  }
  const w = {
    ...opts,
    cwd: opts.cwd === '' ? process.cwd() : opts.cwd,
    patternBytes,
    comps,
    endByte,
    baseIdx,
    rootOs: '',
    rootDir: null,
    openDirs: new Set(),
    matched: new Set(),
    work: [],
    followed: [],
  };
  try {
    runWalk(w, patternStr);
  } finally {
    for (const dir of [...w.openDirs]) {
      closeDir(w, dir);
    }
  }
  return [...w.matched];
}

/** Promise-returning variant of {@link globWalkSync} (Bun.Glob#scan). */
export function globWalk(pattern, options) {
  try {
    return Promise.resolve(globWalkSync(pattern, options));
  } catch (e) {
    return Promise.reject(e);
  }
}
