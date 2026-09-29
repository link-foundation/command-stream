// Language-neutral Bun Shell conformance corpus helpers.
//
// The corpus lives in ./cases/*.json (one file per upstream Bun test file).
// This module is dependency free and works in Node >= 20 and Bun. It knows how
// to:
//   * load the corpus (loadCorpus / allCases)
//   * prepare a fresh temp directory for a case (setupFiles)
//   * turn a case into the arguments of a tagged template call (materialize)
//   * compare an execution result against the case expectations
//     (checkExpectations)
//
// Other language implementations (e.g. Rust) re-implement these few functions
// following the schema documented in README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORPUS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.join(CORPUS_DIR, 'cases');

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Load every cases/*.json file, sorted by file name. */
export function loadCorpus(casesDir = CASES_DIR) {
  return fs
    .readdirSync(casesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const data = JSON.parse(
        fs.readFileSync(path.join(casesDir, file), 'utf8')
      );
      return {
        file,
        source: data.source,
        units: data.units || [],
        nonUnitSites: data.nonUnitSites || [],
      };
    });
}

/** Flat list of every case, annotated with its corpus file and unit line. */
export function allCases(casesDir = CASES_DIR) {
  const out = [];
  for (const { file, source, units } of loadCorpus(casesDir)) {
    for (const unit of units) {
      for (const c of unit.cases || []) {
        out.push({
          ...c,
          file,
          source,
          unitLine: unit.line,
          upstream: unit.upstream,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Placeholders and text specs
// ---------------------------------------------------------------------------

/** Context used for placeholder substitution. */
export function makeContext({
  tempDir,
  node,
  sep = path.sep,
  platform = process.platform,
} = {}) {
  const slashed = toSlash(tempDir ?? '');
  return {
    tempDir: slashed,
    tempDirNative: slashed.replaceAll('/', sep),
    node: toSlash(node ?? 'node'),
    sep,
    platform,
  };
}

function toSlash(p) {
  return String(p).replaceAll('\\', '/');
}

/** Replace {{TEMP}}, {{TEMP_NATIVE}}, {{NODE}} and {{SEP}} inside a string. */
export function subst(str, ctx) {
  if (typeof str !== 'string') {
    return str;
  }
  return str
    .replaceAll('{{TEMP}}', ctx.tempDir)
    .replaceAll('{{TEMP_NATIVE}}', ctx.tempDirNative)
    .replaceAll('{{NODE}}', ctx.node)
    .replaceAll('{{SEP}}', ctx.sep);
}

/**
 * A "text spec" is either a plain string or a small generator object:
 *   {"repeat": "y\n", "count": 3}    -> "y\ny\ny\n"
 *   {"concat": [TEXT, TEXT, ...]}    -> concatenation
 *   {"seq": [1, 5]}                  -> "1\n2\n3\n4\n5\n" (lines of integers)
 * Placeholders are substituted in the result.
 */
export function text(spec, ctx) {
  if (typeof spec === 'string') {
    return subst(spec, ctx);
  }
  if (spec && typeof spec === 'object') {
    if ('repeat' in spec) {
      return text(spec.repeat, ctx).repeat(spec.count ?? 1);
    }
    if ('concat' in spec) {
      return spec.concat.map((s) => text(s, ctx)).join('');
    }
    if ('seq' in spec) {
      const [from, to] = spec.seq;
      let s = '';
      for (let i = from; i <= to; i++) {
        s += `${i}\n`;
      }
      return s;
    }
  }
  throw new Error(`invalid text spec: ${JSON.stringify(spec)}`);
}

// ---------------------------------------------------------------------------
// Temp dir setup
// ---------------------------------------------------------------------------

/**
 * Create the case's files/dirs inside tempDir.
 * files: { "rel/path": TEXT | {"content": TEXT, "mode": "755"} | {"symlink": "target"} }
 * dirs:  ["rel/dir", ...]
 */
export function setupFiles(caseObj, tempDir, ctx = makeContext({ tempDir })) {
  for (const d of caseObj.dirs || []) {
    fs.mkdirSync(path.join(tempDir, d), { recursive: true });
  }
  for (const [rel, spec] of Object.entries(caseObj.files || {})) {
    const full = path.join(tempDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (spec && typeof spec === 'object' && 'symlink' in spec) {
      fs.symlinkSync(subst(spec.symlink, ctx), full);
      continue;
    }
    const isObj = spec && typeof spec === 'object' && 'content' in spec;
    fs.writeFileSync(full, text(isObj ? spec.content : spec, ctx));
    if (isObj && spec.mode) {
      fs.chmodSync(full, parseInt(spec.mode, 8));
    }
  }
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

/** Default hooks that build JS objects for the JS-only value kinds. */
export const defaultFactory = {
  bytes: (s) => Buffer.from(s, 'utf8'),
  outBuffer: ({ size }) => Buffer.alloc(size),
  response: (body) => new Response(body),
  blob: (body) => new Blob([body]),
  jsfile: (absPath) => {
    if (!globalThis.Bun?.file) {
      throw new Error('jsfile values require Bun.file');
    }
    return globalThis.Bun.file(absPath);
  },
};

/**
 * Convert a case into `{ strings, values, env, cwd, buffers }`:
 *   strings - TemplateStringsArray-like (cooked == raw == the corpus strings)
 *   values  - interpolated JS values
 *   env     - env overrides from the case (placeholders substituted)
 *   cwd     - absolute working directory
 *   buffers - map of outBuffer id -> Buffer (to inspect after running)
 */
export function materialize(
  caseObj,
  { tempDir, node, sep = path.sep, factory = {} } = {}
) {
  const ctx = makeContext({ tempDir, node, sep });
  const f = { ...defaultFactory, ...factory };
  const buffers = {};
  return {
    ...materializeTemplate(caseObj, ctx, f, buffers),
    env: Object.fromEntries(
      Object.entries(caseObj.env || {}).map(([k, v]) => [k, subst(v, ctx)])
    ),
    cwd: caseObj.cwd ? path.join(tempDir, subst(caseObj.cwd, ctx)) : tempDir,
    buffers,
  };
}

/** Materialize a {template, values} pair (used for the main script and for setup steps). */
export function materializeTemplate(
  obj,
  ctx,
  f = defaultFactory,
  buffers = {}
) {
  const raw = obj.template.map((s) => subst(s, ctx));
  const strings = [...raw];
  Object.defineProperty(strings, 'raw', { value: Object.freeze([...raw]) });
  Object.freeze(strings);
  const values = (obj.values || []).map((v) =>
    convertValue(v, ctx, f, buffers)
  );
  if (values.length !== raw.length - 1) {
    throw new Error(
      `case ${obj.id ?? ''}: values.length (${values.length}) must be template.length-1 (${raw.length - 1})`
    );
  }
  return { strings, values };
}

function convertValue(v, ctx, f, buffers) {
  if ('string' in v) {
    return text(v.string, ctx).repeat(v.repeat ?? 1);
  }
  if ('number' in v) {
    return v.number;
  }
  if ('bigint' in v) {
    return BigInt(v.bigint);
  }
  if ('bool' in v) {
    return v.bool;
  }
  if ('null' in v) {
    return null;
  }
  if ('undefined' in v) {
    return undefined;
  }
  if ('raw' in v) {
    return { raw: text(v.raw, ctx) };
  }
  if ('array' in v) {
    return v.array.map((x) => convertValue(x, ctx, f, buffers));
  }
  if ('bytes' in v) {
    return f.bytes(text(v.bytes, ctx));
  }
  if ('outBuffer' in v) {
    return (buffers[v.outBuffer.id] = f.outBuffer(v.outBuffer));
  }
  if ('response' in v) {
    return f.response(text(v.response, ctx));
  }
  if ('blob' in v) {
    return f.blob(text(v.blob, ctx));
  }
  if ('jsfile' in v) {
    return f.jsfile(path.join(ctx.tempDir, subst(v.jsfile, ctx)));
  }
  if ('path' in v) {
    return toSlash(path.join(ctx.tempDir, subst(v.path, ctx)));
  }
  throw new Error(`unknown value kind: ${JSON.stringify(v)}`);
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/**
 * Compare actual text with an expectation. Forms:
 *   "exact" | TEXT generator ({repeat}/{concat}/{seq})
 *   {"contains": s | [s...]}  {"notContains": s | [s...]}
 *   {"regex": "...", "flags": "s"}
 *   {"startsWith": s} {"endsWith": s} {"length": n}
 *   {"sortedLines": [...]}  (non-empty lines, sorted, compared to sorted list)
 *   {"lineCount": n}        (number of non-empty lines)
 *   {"any": true}
 *   {"allOf": [EXPECT, ...]} {"oneOf": [EXPECT, ...]}
 *   {"byPlatform": {"windows": EXPECT, "posix": EXPECT, ...}}
 * Returns an error string or null.
 */
export function matchText(actual, exp, ctx) {
  if (exp === undefined) {
    exp = '';
  }
  if (exp && typeof exp === 'object' && 'byPlatform' in exp) {
    return matchText(actual, forPlatform(exp.byPlatform, ctx.platform), ctx);
  }
  if (
    typeof exp === 'string' ||
    'repeat' in exp ||
    'concat' in exp ||
    'seq' in exp
  ) {
    const want = text(exp, ctx);
    return actual === want
      ? null
      : `expected ${show(want)}, got ${show(actual)}`;
  }
  if (exp.any) {
    return null;
  }
  if ('allOf' in exp) {
    for (const e of exp.allOf) {
      const r = matchText(actual, e, ctx);
      if (r) {
        return r;
      }
    }
    return null;
  }
  if ('oneOf' in exp) {
    const errs = exp.oneOf.map((e) => matchText(actual, e, ctx));
    return errs.some((e) => e === null)
      ? null
      : `none of oneOf matched: ${errs.join(' | ')}`;
  }
  if ('contains' in exp) {
    for (const s of [].concat(exp.contains).map((x) => subst(x, ctx))) {
      if (!actual.includes(s)) {
        return `expected to contain ${show(s)}, got ${show(actual)}`;
      }
    }
    if (!('notContains' in exp)) {
      return null;
    }
  }
  if ('notContains' in exp) {
    for (const s of [].concat(exp.notContains).map((x) => subst(x, ctx))) {
      if (actual.includes(s)) {
        return `expected NOT to contain ${show(s)}, got ${show(actual)}`;
      }
    }
    return null;
  }
  if ('regex' in exp) {
    const re = new RegExp(subst(exp.regex, ctx), exp.flags || '');
    return re.test(actual)
      ? null
      : `expected to match /${exp.regex}/${exp.flags || ''}, got ${show(actual)}`;
  }
  if ('startsWith' in exp) {
    const s = text(exp.startsWith, ctx);
    if (!actual.startsWith(s)) {
      return `expected to start with ${show(s)}, got ${show(actual)}`;
    }
    if ('endsWith' in exp) {
      return matchText(actual, { endsWith: exp.endsWith }, ctx);
    }
    if ('length' in exp) {
      return matchText(actual, { length: exp.length }, ctx);
    }
    return null;
  }
  if ('endsWith' in exp) {
    const s = text(exp.endsWith, ctx);
    if (!actual.endsWith(s)) {
      return `expected to end with ${show(s)}, got ${show(actual)}`;
    }
    if ('length' in exp) {
      return matchText(actual, { length: exp.length }, ctx);
    }
    return null;
  }
  if ('length' in exp) {
    return actual.length === exp.length
      ? null
      : `expected length ${exp.length}, got ${actual.length}: ${show(actual)}`;
  }
  if ('sortedLines' in exp) {
    const got = actual
      .split('\n')
      .filter((s) => s.length > 0)
      .sort();
    const want = exp.sortedLines.map((s) => subst(s, ctx)).sort();
    return JSON.stringify(got) === JSON.stringify(want)
      ? null
      : `expected sorted lines ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
  }
  if ('lineCount' in exp) {
    const n = actual.split('\n').filter((s) => s.length > 0).length;
    return n === exp.lineCount
      ? null
      : `expected ${exp.lineCount} lines, got ${n}: ${show(actual)}`;
  }
  return `unknown text expectation ${JSON.stringify(exp)}`;
}

function show(s) {
  const j = JSON.stringify(s);
  return j.length > 400 ? `${j.slice(0, 400)}...(${s.length} chars)` : j;
}

function matchExit(actual, exp) {
  if (typeof exp === 'number') {
    return actual === exp ? null : `expected exitCode ${exp}, got ${actual}`;
  }
  if (exp && 'not' in exp) {
    return actual !== exp.not
      ? null
      : `expected exitCode != ${exp.not}, got ${actual}`;
  }
  if (exp && 'oneOf' in exp) {
    return exp.oneOf.includes(actual)
      ? null
      : `expected exitCode in ${JSON.stringify(exp.oneOf)}, got ${actual}`;
  }
  if (exp && exp.any) {
    return null;
  }
  return `unknown exitCode expectation ${JSON.stringify(exp)}`;
}

/**
 * Check a result against caseObj.expect.
 * result: { stdout, stderr, exitCode, error, tempDir, buffers, node, sep }
 *   stdout/stderr are strings (or Buffers), error is the thrown value (if any).
 * Rules:
 *   - without expect.error, an error must NOT have been thrown; omitted
 *     stdout/stderr mean "" and omitted exitCode means 0.
 *   - with expect.error, an error MUST have been thrown; stdout/stderr/exitCode
 *     are only checked when explicitly given (compared against error fields).
 * Returns an array of mismatch descriptions (empty array = pass).
 */
export function checkExpectations(caseObj, result) {
  const exp = caseObj.expect || {};
  const ctx = makeContext({
    tempDir: result.tempDir,
    node: result.node,
    sep: result.sep,
  });
  const errs = [];
  const str = (x) =>
    x === undefined || x === null
      ? ''
      : Buffer.isBuffer(x) || x instanceof Uint8Array
        ? Buffer.from(x).toString('utf8')
        : String(x);
  const stdout = str(result.stdout);
  const stderr = str(result.stderr);

  if ('error' in exp && exp.error !== false) {
    if (result.error === undefined) {
      errs.push(
        `expected an error to be thrown, but none was (exitCode ${result.exitCode}, stdout ${show(stdout)}, stderr ${show(stderr)})`
      );
    } else if (exp.error !== true) {
      const msg = String(result.error?.message ?? result.error);
      const r = matchText(
        msg,
        typeof exp.error === 'string' ? { contains: exp.error } : exp.error,
        ctx
      );
      if (r) {
        errs.push(`error message: ${r}`);
      }
    }
    if ('stdout' in exp) {
      pushIf(errs, 'stdout', matchText(stdout, exp.stdout, ctx));
    }
    if ('stderr' in exp) {
      pushIf(errs, 'stderr', matchText(stderr, exp.stderr, ctx));
    }
    if ('exitCode' in exp) {
      pushIf(errs, 'exitCode', matchExit(result.exitCode, exp.exitCode));
    }
  } else {
    if (result.error !== undefined) {
      errs.push(
        `unexpected error thrown: ${String(result.error?.message ?? result.error)}`
      );
    } else {
      pushIf(errs, 'stdout', matchText(stdout, exp.stdout, ctx));
      pushIf(errs, 'stderr', matchText(stderr, exp.stderr, ctx));
      pushIf(errs, 'exitCode', matchExit(result.exitCode, exp.exitCode ?? 0));
    }
  }

  const tempDir = result.tempDir;
  for (const [rel, want] of Object.entries(exp.files || {})) {
    const full = path.join(tempDir, subst(rel, ctx));
    let got;
    try {
      got = fs.readFileSync(full, 'utf8');
    } catch (e) {
      errs.push(`file ${rel}: cannot read (${e.code || e.message})`);
      continue;
    }
    pushIf(errs, `file ${rel}`, matchText(got, want, ctx));
  }
  for (const rel of exp.exists || []) {
    if (!lexists(path.join(tempDir, subst(rel, ctx)))) {
      errs.push(`expected ${rel} to exist`);
    }
  }
  for (const rel of exp.absent || []) {
    if (lexists(path.join(tempDir, subst(rel, ctx)))) {
      errs.push(`expected ${rel} to NOT exist`);
    }
  }
  for (const [rel, kind] of Object.entries(exp.types || {})) {
    let st;
    try {
      st = fs.lstatSync(path.join(tempDir, subst(rel, ctx)));
    } catch {
      errs.push(`expected ${rel} to be a ${kind}, but it does not exist`);
      continue;
    }
    const actual = st.isSymbolicLink()
      ? 'symlink'
      : st.isDirectory()
        ? 'dir'
        : st.isFile()
          ? 'file'
          : 'other';
    if (actual !== kind) {
      errs.push(`expected ${rel} to be a ${kind}, got ${actual}`);
    }
  }
  for (const [id, want] of Object.entries(exp.buffers || {})) {
    const buf = result.buffers?.[id];
    if (!buf) {
      errs.push(`buffer ${id} missing`);
      continue;
    }
    const got = Buffer.from(buf).toString('utf8').replace(/\0+$/, '');
    pushIf(errs, `buffer ${id}`, matchText(got, want, ctx));
  }
  return errs;
}

function pushIf(arr, label, err) {
  if (err) {
    arr.push(`${label}: ${err}`);
  }
}

function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the entry of a {"byPlatform": {...}} map for `platform`: the exact
 * platform ("linux", "darwin", "win32"), then its family ("windows",
 * "posix"), then "default".
 */
export function forPlatform(map, platform = process.platform) {
  for (const key of [platform, platformFamily(platform), 'default']) {
    if (key in map) {
      return map[key];
    }
  }
  throw new Error(`byPlatform has no entry for ${platform}`);
}

function platformFamily(platform) {
  return platform === 'win32' ? 'windows' : 'posix';
}

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

/** Returns a skip reason, or null if the case applies to this environment. */
export function skipReason(
  caseObj,
  { platform = process.platform, language = 'js', which = () => true } = {}
) {
  if (caseObj.platforms) {
    const tags = new Set([platform, platformFamily(platform)]);
    if (!caseObj.platforms.some((p) => tags.has(p))) {
      return `platform ${platform} not in ${caseObj.platforms.join(',')}`;
    }
  }
  if (caseObj.languages && !caseObj.languages.includes(language)) {
    return `language ${language} not in ${caseObj.languages.join(',')}`;
  }
  for (const bin of caseObj.requires || []) {
    if (bin === 'node') {
      continue;
    } // {{NODE}} is always provided by the runner
    if (!which(bin)) {
      return `requires ${bin}`;
    }
  }
  return null;
}
