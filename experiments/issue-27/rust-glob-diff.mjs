// Differential test: js/src/bun-shell/glob.mjs vs rust/src/bun_shell/glob.rs.
//
// Usage (from the repository root, with node or bun):
//   node experiments/issue-27/rust-glob-diff.mjs [seed] [matchCases] [walkCases]
//
// Generates (pattern, path) match cases, hasGlobSyntax cases and walker cases
// on random temp trees (the generators of glob-fuzz.mjs), runs every case
// through the JS port, then through the Rust port (via the ignored
// `bun_shell::glob::tests::glob_diff_harness` test, which reads/writes JSON
// lines), and compares the results exactly: match results, walk paths in
// order, and error code/syscall/path/errno/message.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  globMatch,
  globWalkSync,
  hasGlobSyntax,
} from '../../js/src/bun-shell/glob.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const seed = Number(process.argv[2] ?? 12345);
const MATCH_CASES = Number(process.argv[3] ?? 30000);
const WALK_CASES = Number(process.argv[4] ?? 5000);

let rngState = seed >>> 0 || 1;
function rand() {
  // xorshift32
  rngState ^= rngState << 13;
  rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 0x100000000;
}
const randInt = (n) => Math.floor(rand() * n);
const pick = (arr) => arr[randInt(arr.length)];

// ---------------------------------------------------------------------------
// Generators (copied from glob-fuzz.mjs)
// ---------------------------------------------------------------------------

const META = [
  '*',
  '**',
  '?',
  '[',
  ']',
  '!',
  '{',
  '}',
  ',',
  '\\',
  '/',
  '.',
  '^',
  '-',
];
const LITS = [
  'a',
  'b',
  'c',
  'x',
  'é',
  'ü',
  '日',
  '本',
  '😀',
  'Z',
  '0',
  ' ',
  'n',
  't',
];
const RARE = ['\uD800', '\uDC00', 'ÿ', '\u0080', '߿', 'ࠀ', '￿'];

function randToken() {
  const r = rand();
  if (r < 0.45) {
    return pick(META);
  }
  if (r < 0.95) {
    return pick(LITS);
  }
  return pick(RARE);
}

function randPattern(maxLen) {
  let s = '';
  const n = randInt(maxLen + 1);
  for (let i = 0; i < n; i++) {
    s += randToken();
  }
  return s;
}

function randPathString(maxLen) {
  let s = '';
  const n = randInt(maxLen + 1);
  const alphabet = [
    ...LITS,
    '/',
    '/',
    '.',
    '.',
    ...RARE.slice(0, 3),
    '*',
    '{',
    ',',
  ];
  for (let i = 0; i < n; i++) {
    s += pick(alphabet);
  }
  return s;
}

function concretize(p) {
  let out = '';
  for (const c of p) {
    if (c === '*') {
      out += pick(['', 'a', 'é', 'x/y', 'ab', '/', '.a']);
    } else if (c === '?') {
      out += pick(['a', '日', '/', '']);
    } else if ('[]{},!'.includes(c)) {
      out += rand() < 0.5 ? '' : pick(['a', 'b', 'é', c]);
    } else if (c !== '\\') {
      out += c;
    }
  }
  return out;
}

const STRUCTURED = [
  '**/*.txt',
  'a/**/b',
  '{a,b}/*',
  '*.{js,ts}',
  '[a-z]*',
  '[!a]?',
  '**',
  '!*.md',
  '!!a',
  'a/**',
  '**/a',
  '{a,{b,c}}',
  '[é-ü]',
  '\\*',
  'a\\/b',
  '*/**/*',
  '**/**/x',
  '/**/',
  '{,a}',
  '{a,}b',
  '[]]',
  '[^]]',
  'a{b',
  'a}b',
  `${'{a,'.repeat(12)}b${'}'.repeat(12)}`,
  `${'{a,'.repeat(9)}b${'}'.repeat(9)}`,
  '{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}{o,p}{q,r}{s,t}{u,v}{w,x}{y,z}{0,1}',
  '\\a\\b\\n\\r\\t',
  '[\\n]',
  '[\\]]',
  '[a-]',
  '[-a]',
  '[\\',
  '**a',
  'a**',
  '*/**',
];

function matchCase() {
  let p;
  if (rand() < 0.25) {
    p = pick(STRUCTURED);
    if (rand() < 0.5) {
      p += randPattern(3);
    }
  } else {
    p = randPattern(10);
  }
  const s = rand() < 0.5 ? concretize(p) : randPathString(10);
  return [p, s];
}

const NAMES = [
  'a',
  'b',
  'c',
  'x.txt',
  'y.md',
  '.h',
  '.git',
  '..x',
  'é',
  '日本',
  'a b',
  '[x]',
  '*',
  '{a,b}',
  'ab',
  'b.txt',
  '.x.txt',
  'a.txt',
];

const lockedDirs = [];
function unlockAll() {
  for (const d of lockedDirs) {
    try {
      fs.chmodSync(d, 0o755);
    } catch {
      // already removed
    }
  }
}

function buildTree(root) {
  const dirs = [''];
  const files = [];
  const nDirs = 3 + randInt(8);
  for (let i = 0; i < nDirs; i++) {
    const parent = pick(dirs);
    const rel = parent ? `${parent}/${pick(NAMES)}` : pick(NAMES);
    if (
      dirs.includes(rel) ||
      files.includes(rel) ||
      rel.split('/').length > 4
    ) {
      continue;
    }
    fs.mkdirSync(path.join(root, rel));
    dirs.push(rel);
  }
  const nFiles = 4 + randInt(12);
  for (let i = 0; i < nFiles; i++) {
    const parent = pick(dirs);
    const rel = parent ? `${parent}/${pick(NAMES)}` : pick(NAMES);
    if (dirs.includes(rel) || files.includes(rel)) {
      continue;
    }
    fs.writeFileSync(path.join(root, rel), 'x');
    files.push(rel);
  }
  const nLinks = 2 + randInt(6);
  const taken = new Set([...dirs, ...files]);
  for (let i = 0; i < nLinks; i++) {
    const parent = pick(dirs);
    const name = pick([
      'l',
      'ld',
      'lf',
      'lb',
      'loop',
      'up',
      '.ls',
      'lé',
      ...NAMES,
    ]);
    const rel = parent ? `${parent}/${name}` : name;
    if (taken.has(rel)) {
      continue;
    }
    const kind = randInt(6);
    let target;
    if (kind === 0 && files.length) {
      target = path.relative(
        path.join(root, parent),
        path.join(root, pick(files))
      );
    } else if (kind === 1) {
      target =
        path.relative(path.join(root, parent), path.join(root, pick(dirs))) ||
        '.';
    } else if (kind === 2) {
      target = 'nowhere';
    } else if (kind === 3) {
      target = name; // self loop
    } else if (kind === 4) {
      target = '..';
    } else {
      target = path.join(root, pick(dirs));
    }
    fs.symlinkSync(target, path.join(root, rel));
    taken.add(rel);
  }
  // An unreadable directory (EACCES when not running as root).
  if (rand() < 0.5) {
    const parent = pick(dirs);
    const rel = parent ? `${parent}/na` : 'na';
    if (!taken.has(rel)) {
      fs.mkdirSync(path.join(root, rel));
      fs.writeFileSync(path.join(root, rel, 'x.txt'), 'x');
      fs.chmodSync(path.join(root, rel), 0o000);
      lockedDirs.push(path.join(root, rel));
    }
  }
  return { dirs, files };
}

/** The fixed tree of js/tests/bun-shell-glob.test.mjs. */
function buildFixture(root) {
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, '.h'));
  fs.mkdirSync(path.join(root, 'é'));
  for (const f of [
    'a/x.txt',
    'a/b/y.txt',
    '.h/z',
    'é/日本.txt',
    'top',
    '.dot',
  ]) {
    fs.writeFileSync(path.join(root, f), '');
  }
  fs.symlinkSync('a', path.join(root, 'la'));
  fs.symlinkSync('top', path.join(root, 'lf'));
  fs.symlinkSync('nowhere', path.join(root, 'broken'));
  fs.symlinkSync('loop', path.join(root, 'loop'));
  fs.symlinkSync('..', path.join(root, 'a', 'up'));
}

const COMPONENTS = [
  '*',
  '**',
  '*',
  '**',
  '?',
  'a',
  'b',
  '.',
  '..',
  '*.txt',
  '*.md',
  '.*',
  '[ab]*',
  '{a,b}',
  '{a,.h}',
  '.h',
  'x.txt',
  'é',
  'l*',
  '[!a]*',
  '?*',
  'lf',
  'ld',
  'lb',
  'loop',
  'up',
  '*b',
  'a*',
  '\\*',
  '日本',
  '{x.txt,y.md}',
  '*.{txt,md}',
  '**',
  'nonexist',
  '.git',
  'a b',
  '[x]',
  '!a',
  'ab',
  'na',
  'n?',
];

function mutatedTreePath(tree) {
  const parts = pick([...tree.files, ...tree.dirs.slice(1)]).split('/');
  return parts
    .map((part) => {
      const r = rand();
      if (r < 0.2) {
        return '*';
      }
      if (r < 0.3) {
        return '**';
      }
      if (r < 0.4) {
        return `${part[0]}*`;
      }
      if (r < 0.45) {
        return `{${part},zz}`;
      }
      if (r < 0.5) {
        return `**/${part}`;
      }
      return part;
    })
    .join('/');
}

function randWalkPattern(root, tree) {
  const n = 1 + randInt(4);
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      rand() < 0.15 && tree.dirs.length > 1
        ? pick(tree.dirs.slice(1)).split('/')[0]
        : pick(COMPONENTS)
    );
  }
  let p = rand() < 0.35 ? mutatedTreePath(tree) : parts.join('/');
  const r = rand();
  if (r < 0.1) {
    p = `./${p}`;
  } else if (r < 0.2) {
    p = `${root}/${p}`;
  } else if (r < 0.23) {
    p = `${root}/${pick(tree.dirs)}`;
  } else if (r < 0.26) {
    p = pick([...tree.files, ...tree.dirs]);
  }
  if (rand() < 0.1) {
    p += '/';
  }
  if (rand() < 0.03) {
    p = p.replace('/', '//');
  }
  if (rand() < 0.02) {
    p = pick(['', '/', '.', '..', './', '**/']);
  }
  return p;
}

const OPTION_KEYS = [
  'dot',
  'absolute',
  'followSymlinks',
  'throwErrorOnBrokenSymlink',
  'onlyFiles',
];

function randOptions(root, tree) {
  const opts = {};
  const bits = randInt(32);
  OPTION_KEYS.forEach((k, i) => {
    const r = rand();
    if (r < 0.1) {
      return; // default
    }
    if (r < 0.13) {
      opts[k] = pick([0, 1, 'yes', null]);
      return;
    }
    opts[k] = Boolean(bits & (1 << i));
  });
  const c = rand();
  if (c < 0.78) {
    opts.cwd = root;
  } else if (c < 0.86) {
    opts.cwd = path.join(root, pick(tree.dirs));
  } else if (c < 0.91) {
    opts.cwd = path.relative(process.cwd(), root);
  } else if (c < 0.94) {
    opts.cwd = path.join(root, pick([...tree.files, 'nonexist', 'loop', 'na']));
  } else if (c < 0.98) {
    opts.cwd = `${root}/${pick(tree.dirs)}/..`;
  } else if (c < 0.99) {
    opts.cwd = '';
  } else {
    delete opts.cwd;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Running both sides
// ---------------------------------------------------------------------------

/** What Rust sees: the UTF-8 round trip turns lone surrogates into U+FFFD. */
const utf8 = (s) => Buffer.from(String(s), 'utf8').toString('utf8');

/** Bun's option parsing: a present non-boolean value counts as `false`. */
function boolOption(opts, key, fallback) {
  const v = opts[key];
  if (v === undefined || v === null) {
    return fallback;
  }
  return typeof v === 'boolean' ? v : false;
}

function errInfo(e) {
  return {
    code: e.code ?? null,
    syscall: e.code ? (e.syscall ?? null) : null,
    path: e.code ? (e.path ?? null) : null,
    errno: e.errno ?? null,
    message: e.message,
  };
}

/** JSON with sorted object keys (serde_json and JS order keys differently). */
function canonical(v) {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : x
  );
}

function runJs(c) {
  if (c.t === 'm') {
    const bytes = Buffer.from(c.p, 'utf8');
    let bangs = 0;
    while (bangs < bytes.length && bytes[bangs] === 0x21) {
      bangs++;
    }
    return { m: globMatch(c.p, c.s), n: bangs % 2 === 1 };
  }
  if (c.t === 'h') {
    return { h: hasGlobSyntax(c.p) };
  }
  try {
    return { ok: globWalkSync(c.p, c.opts) };
  } catch (e) {
    return { err: errInfo(e) };
  }
}

function toRustCase(c) {
  if (c.t === 'm') {
    return { t: 'm', p: utf8(c.p), s: utf8(c.s) };
  }
  if (c.t === 'h') {
    return { t: 'h', p: utf8(c.p) };
  }
  const o = c.opts ?? {};
  return {
    t: 'w',
    p: utf8(c.p),
    cwd: typeof o.cwd === 'string' ? o.cwd : '',
    dot: boolOption(o, 'dot', false),
    absolute: boolOption(o, 'absolute', false),
    followSymlinks: boolOption(o, 'followSymlinks', false),
    throwErrorOnBrokenSymlink: boolOption(
      o,
      'throwErrorOnBrokenSymlink',
      false
    ),
    onlyFiles: boolOption(o, 'onlyFiles', true),
  };
}

function runRust(cases, workDir) {
  const input = path.join(workDir, 'in.jsonl');
  const output = path.join(workDir, 'out.jsonl');
  fs.writeFileSync(
    input,
    `${cases.map((c) => JSON.stringify(toRustCase(c))).join('\n')}\n`
  );
  execFileSync(
    'cargo',
    [
      'test',
      '--quiet',
      '--lib',
      'bun_shell::glob::tests::glob_diff_harness',
      '--',
      '--ignored',
      '--exact',
    ],
    {
      cwd: path.join(repoRoot, 'rust'),
      env: {
        ...process.env,
        GLOB_DIFF_IN: input,
        GLOB_DIFF_OUT: output,
        GLOB_DIFF_CWD: process.cwd(),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );
  return fs
    .readFileSync(output, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const base = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'rust-glob-diff-'))
);
const ioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-glob-diff-io-'));
const cases = [];
try {
  // Match and hasGlobSyntax cases.
  for (let k = 0; k < MATCH_CASES; k++) {
    const [p, s] = matchCase();
    cases.push({ t: 'm', p, s });
    if (k % 3 === 0) {
      cases.push({ t: 'h', p });
    }
  }

  // Fixed tree: every option combination for a set of patterns.
  const fixture = path.join(base, 'fixture');
  fs.mkdirSync(fixture);
  buildFixture(fixture);
  process.chdir(fixture);
  const fixedPatterns = [
    '*',
    '**',
    '*/*',
    '**/*.txt',
    'l*/**',
    '{a,é}/*',
    '.*',
    './*',
    'a/../t*',
    '*/',
    './',
    'a/x.txt',
    'a/missing',
    '',
    'la/*',
    'b*',
    'broken',
    'loop',
    'loop/*',
    'a/up/*',
    '**/up/**',
    'lf',
    'lf/',
    'top/*',
    `${fixture}/a/*`,
    `${fixture}/**/*.txt`,
    `${fixture}/a`,
    `${fixture}/nope/*`,
    `${fixture}/top/*`,
    '/',
    '.',
    '..',
    '../fixture/*',
    '**/..',
    `${'./'.repeat(2100)}*`,
    `${'../'.repeat(1400)}*`,
    `${'x/'.repeat(2100)}*`,
  ];
  for (const p of fixedPatterns) {
    for (let bits = 0; bits < 32; bits++) {
      const opts = { cwd: bits & 1 && bits & 4 ? '.' : fixture };
      OPTION_KEYS.forEach((k, i) => {
        opts[k] = Boolean(bits & (1 << i));
      });
      cases.push({ t: 'w', p, opts });
    }
  }
  for (const cwd of [
    'x'.repeat(5000),
    `${fixture}/${'x'.repeat(4100)}`,
    'nope',
    'top',
    'a/..',
  ]) {
    cases.push({ t: 'w', p: '*', opts: { cwd } });
    cases.push({ t: 'w', p: '*', opts: { cwd, absolute: true } });
  }

  // Random trees.
  let root = null;
  let tree = null;
  for (let k = 0; k < WALK_CASES; k++) {
    if (k % 100 === 0) {
      root = path.join(base, `t${k}`);
      fs.mkdirSync(root);
      tree = buildTree(root);
    }
    cases.push({
      t: 'w',
      p: randWalkPattern(root, tree),
      opts: randOptions(root, tree),
    });
  }

  const jsResults = cases.map(runJs);
  // The JSONL files live outside the walked trees so they never show up in results.
  const rustResults = runRust(cases, ioDir);
  if (rustResults.length !== cases.length) {
    throw new Error(
      `rust returned ${rustResults.length} results for ${cases.length} cases`
    );
  }

  const stats = {};
  const examples = [];
  cases.forEach((c, i) => {
    const s = (stats[c.t] ??= {
      cases: 0,
      mismatches: 0,
      positive: 0,
      errors: 0,
    });
    s.cases++;
    const js = jsResults[i];
    if (js.m || js.h || js.ok?.length) {
      s.positive++;
    }
    if (js.err) {
      s.errors++;
    }
    if (canonical(js) !== canonical(rustResults[i])) {
      s.mismatches++;
      if (examples.length < 20) {
        examples.push({ case: c, js, rust: rustResults[i] });
      }
    }
  });
  console.log(`seed ${seed}`);
  const names = { m: 'match', h: 'hasGlobSyntax', w: 'walk' };
  let total = 0;
  for (const [t, s] of Object.entries(stats)) {
    total += s.mismatches;
    console.log(
      `${names[t]}: ${s.cases} cases, ${s.positive} true/non-empty, ${s.errors} errors, ${s.mismatches} mismatches`
    );
  }
  for (const e of examples) {
    console.log('  MISMATCH', JSON.stringify(e).slice(0, 2000));
  }
  console.log(total === 0 ? 'OK: 0 mismatches' : `FAIL: ${total} mismatches`);
  process.exitCode = total === 0 ? 0 : 1;
} finally {
  process.chdir(os.tmpdir());
  unlockAll();
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(ioDir, { recursive: true, force: true });
}
