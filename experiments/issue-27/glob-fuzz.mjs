// Differential fuzzer: js/src/bun-shell/glob.mjs vs Bun.Glob.
//
// Usage (from the repository root):
//   bun experiments/issue-27/glob-fuzz.mjs [seed] [matchCases] [walkCases]
//
// Compares `globMatch(p, s)` with `new Bun.Glob(p).match(s)` and
// `globWalkSync(p, opts)` with `[...new Bun.Glob(p).scanSync(opts)]` (exact
// order, and error code/syscall/path/errno/message) on random temp trees.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globMatch, globWalkSync } from '../../js/src/bun-shell/glob.mjs';

if (typeof Bun === 'undefined') {
  console.error('run this with bun');
  process.exit(2);
}

const seed = Number(process.argv[2] ?? 12345);
const MATCH_CASES = Number(process.argv[3] ?? 30000);
const WALK_CASES = Number(process.argv[4] ?? 4000);

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
// Match fuzzing
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

// Derive a likely-matching path from a pattern.
function concretize(p) {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      out += pick(['', 'a', 'é', 'x/y', 'ab', '/', '.a']);
    } else if (c === '?') {
      out += pick(['a', '日', '/', '']);
    } else if (
      c === '[' ||
      c === ']' ||
      c === '{' ||
      c === '}' ||
      c === ',' ||
      c === '!'
    ) {
      out += rand() < 0.5 ? '' : pick(['a', 'b', 'é', c]);
    } else if (c === '\\') {
      // drop
    } else {
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

function runMatchFuzz() {
  let mismatches = 0;
  let trues = 0;
  const examples = [];
  for (let k = 0; k < MATCH_CASES; k++) {
    const [p, s] = matchCase();
    let expected;
    let expectedErr = null;
    try {
      expected = new Bun.Glob(p).match(s);
    } catch (e) {
      expectedErr = String(e);
    }
    let actual;
    let actualErr = null;
    try {
      actual = globMatch(p, s);
    } catch (e) {
      actualErr = String(e);
    }
    if (expected) {
      trues++;
    }
    if (expected !== actual || expectedErr !== actualErr) {
      mismatches++;
      if (examples.length < 20) {
        examples.push({ p, s, expected, actual, expectedErr, actualErr });
      }
    }
  }
  console.log(
    `match: ${MATCH_CASES} cases, ${trues} expected-true, ${mismatches} mismatches`
  );
  for (const e of examples) {
    console.log('  MISMATCH', JSON.stringify(e));
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Walk fuzzing
// ---------------------------------------------------------------------------

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

// Take an existing path and replace some components with glob syntax.
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

function randOptions(root, tree) {
  const opts = {};
  const bits = randInt(32);
  const keys = [
    'dot',
    'absolute',
    'followSymlinks',
    'throwErrorOnBrokenSymlink',
    'onlyFiles',
  ];
  keys.forEach((k, i) => {
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
  if (c < 0.8) {
    opts.cwd = root;
  } else if (c < 0.88) {
    opts.cwd = path.join(root, pick(tree.dirs));
  } else if (c < 0.93) {
    opts.cwd = path.relative(process.cwd(), root);
  } else if (c < 0.96) {
    opts.cwd = path.join(root, pick([...tree.files, 'nonexist', 'loop', 'na']));
  } else {
    opts.cwd = `${root}/${pick(tree.dirs)}/..`;
  }
  return opts;
}

function errInfo(e) {
  return {
    code: e.code,
    syscall: e.syscall,
    path: e.path,
    errno: e.errno,
    message: e.message,
  };
}

function runOne(fn) {
  try {
    return { ok: fn() };
  } catch (e) {
    return { err: errInfo(e) };
  }
}

function runWalkFuzz() {
  let mismatches = 0;
  let errorsCompared = 0;
  let nonEmpty = 0;
  const examples = [];
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-fuzz-'));
  let root = null;
  let tree = null;
  try {
    for (let k = 0; k < WALK_CASES; k++) {
      if (k % 100 === 0) {
        root = path.join(base, `t${k}`);
        fs.mkdirSync(root);
        tree = buildTree(root);
      }
      const p = randWalkPattern(root, tree);
      const opts = randOptions(root, tree);
      const expected = runOne(() => [...new Bun.Glob(p).scanSync({ ...opts })]);
      const actual = runOne(() => globWalkSync(p, { ...opts }));
      if (expected.err) {
        errorsCompared++;
      } else if (expected.ok.length) {
        nonEmpty++;
      }
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches++;
        if (examples.length < 20) {
          examples.push({ p, opts, expected, actual });
        }
      }
    }
  } finally {
    unlockAll();
    fs.rmSync(base, { recursive: true, force: true });
  }
  console.log(
    `walk: ${WALK_CASES} cases, ${nonEmpty} non-empty results, ${errorsCompared} errors, ${mismatches} mismatches`
  );
  for (const e of examples) {
    console.log('  MISMATCH', JSON.stringify(e));
  }
  return mismatches;
}

console.log(`seed ${seed}`);
const total = runMatchFuzz() + runWalkFuzz();
console.log(total === 0 ? 'OK: 0 mismatches' : `FAIL: ${total} mismatches`);
process.exit(total === 0 ? 0 : 1);
