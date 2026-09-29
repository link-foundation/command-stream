// Differential test of the JS `rm` builtin port against Bun's real `rm`.
//
// Run with Bun: `bun experiments/issue-27/rm-diff.mjs`. Both sides run in the
// same process: for every probe and output mode, a fresh fixture tree is
// built, then the command runs through Bun.$ (RUNS times, since Bun removes
// operands/subdirectories in parallel thread-pool tasks) and once through the
// JS port. Compared: exit code, stdout, stderr and the remaining tree. The JS
// result must equal one of the observed Bun results; results that differ from
// every observed Bun result only in the order of the `-v` lines (Bun's thread
// pool order) are counted separately.
//
// Output modes: 'buf' (captured), 'out' (`> file`), 'err' (`2> file`),
// 'fullout' (`> /dev/full`) and 'fullerr' (`2> /dev/full`); the JS port gets
// `new Writer(new FdTarget(fd))` as an fd output for the redirected stream.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS = Number(process.env.RUNS ?? 8);
const here = path.dirname(fileURLToPath(import.meta.url));
const jsSrc = path.resolve(here, '../../js/src/bun-shell');

const { Builtin } = await import(path.join(jsSrc, 'builtin.mjs'));
const { rm } = await import(path.join(jsSrc, 'builtins/rm.mjs'));
const { ShellExecEnv, envMapFromObject } = await import(
  path.join(jsSrc, 'env.mjs')
);
const { Writer, FdTarget } = await import(path.join(jsSrc, 'io.mjs'));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-diff-'));
const root = path.join(base, 'w', 'root');
const outFile = path.join(base, 'out.txt');

const LONG = 'x'.repeat(300);
const LONGER = 'y'.repeat(1100);

// [args, cwd] - cwd is relative to the fixture root unless absolute.
// '@/' prefixes an argument with the absolute fixture root.
const PROBES = [
  // Option parsing.
  [[]],
  [['-f']],
  [['-rf']],
  [['-z', 'a']],
  [['-fz', 'a']],
  [['-vZq', 'a']],
  [['--', 'a']],
  [['--bad', 'a']],
  [['-'], '.'],
  [['-', 'a']],
  [['-', '-v', 'a']],
  [['--recursive', 'd']],
  [['--verbose', 'a']],
  [['--dir', 'e']],
  [['--dir', '--verbose', 'e']],
  [['--interactive=never', 'a']],
  [['--interactive=once', 'a']],
  [['--interactive=always', 'a']],
  [['--interactive=bogus', 'a']],
  [['--interactive', 'a']],
  [['-i', 'a']],
  [['-I', 'a']],
  [['-if', 'a']],
  [['-fi', 'a']],
  [['-f', '-i', 'a']],
  [['--preserve-root', 'a']],
  [['--no-preserve-root', '-v', 'a']],
  [['-R', '-v', 'd']],
  [['-v', 'a', '-f']],
  [['a', '-z']],
  // Preserve-root safety check.
  [['/']],
  [['/tmp']],
  [['/zzz']],
  [['/tmp/']],
  [['//']],
  [['/.']],
  [['/tmp/../zzz']],
  [['//tmp']],
  [['-rf', '/']],
  [['-v', 'a', '/tmp']],
  [['-v', 'a', 'nope', '/zzz']],
  [['/zzz/y']],
  [['-f', '/zzz/y']],
  [['.'], '/tmp'],
  [['./'], '/tmp'],
  [['..'], '/tmp'],
  [['a'], '/'],
  [['tmp/zzz'], '/'],
  [['../'.repeat(2000)]],
  // Files.
  [['a']],
  [['-v', 'a']],
  [['-v', '@/a']],
  [['-v', './a']],
  [['-v', './/a']],
  [['-v', 'd/../a']],
  [['nope']],
  [['-v', 'nope']],
  [['-f', 'nope']],
  [['-fv', 'nope']],
  [['-fv', '@/nope']],
  [['']],
  [['-f', '']],
  [['-v', 'a/']],
  [['-v', 'a/.']],
  [['-fv', 'a/']],
  [['-v', 'a', 'b', 'f']],
  [['-v', 'a', 'nope', 'b']],
  [['nope', 'a']],
  [['-v', 'a', 'a']],
  [['-fv', 'a', 'a']],
  [['-v', 'ro/f']],
  [['-fv', 'ro/f']],
  [['-v', 'noperm/f']],
  [['-v', 'l']],
  [['-v', 'l/']],
  [['-rv', 'l/']],
  [['-rv', 'l']],
  [['-dv', 'l']],
  [['-v', 'fl']],
  [['-v', 'fl/']],
  [['-v', 'dangling']],
  [['-rv', 'dangling/']],
  [['-v', 'd/a/x']],
  [['-rv', 'd/a/x']],
  [['-dv', 'd/a/x']],
  [['-v', LONG]],
  [['-fv', LONG]],
  [['-v', LONGER, 'a']],
  [['-rv', `d/${LONG}`]],
  // Directories.
  [['d']],
  [['-v', 'd']],
  [['-f', 'd']],
  [['-d', 'e']],
  [['-dv', 'e']],
  [['-dv', '@/e']],
  [['-dv', 'e/']],
  [['-d', 'd']],
  [['-df', 'd']],
  [['-d', 'a']],
  [['-dv', 'a']],
  [['-df', 'nope']],
  [['-dfv', 'nope']],
  [['-dv', 'e', 'd', 'a']],
  [['-r', 'd']],
  [['-rv', 'd']],
  [['-rv', 'd/']],
  [['-rfv', 'd/']],
  [['-rv', './d//']],
  [['-rv', 'd/s1']],
  [['-rv', 'd/s1/']],
  [['-rv', 'd/s1/..']],
  [['-rv', 'd/s1/../s1']],
  [['-rv', 'd/s3']],
  [['-rv', 'e']],
  [['-rv', '@/d']],
  [['-rv', '@/d/']],
  [['-rv', '@/d/s1/../s1']],
  [['-rv', '../d'], 'sub'],
  [['-rv', '../d/s1'], 'sub'],
  [['-r', '.'], 'sub'],
  [['-rv', '.'], 'sub'],
  [['-rv', './'], 'sub'],
  [['-rv', '..'], 'sub/m'],
  [['-rv', 'sub/m/..']],
  [['-rv', 'a']],
  [['-rv', 'nope']],
  [['-rfv', 'nope']],
  [['-rv', 'ro']],
  [['-rfv', 'ro']],
  [['-rv', 'noperm']],
  [['-rfv', 'noperm']],
  [['-rv', 'e', 'd']],
  [['-rv', 'd', 'e']],
  [['-rv', 'd', 'nope']],
  [['-r', 'nope', 'd']],
  [['-rv', 'nope', 'a', 'd']],
  [['-rv', 'd', 'd']],
  [['-rfv', 'd', 'd']],
  [['-rv', 'ro', 'sub']],
  [['-rv', 'sub', 'ro']],
  [['-rv', 'sub', 'e', 'a', 'b']],
  [['-rv', 'big']],
  [['-rv', 'wide']],
  [['-rv', 'p']],
];

const MODES = ['buf', 'out', 'err', 'fullout', 'fullerr'];

function makeFixture() {
  resetTree(base);
  fs.mkdirSync(root, { recursive: true });
  const w = (p, s = p) => fs.writeFileSync(path.join(root, p), `${s}\n`);
  const d = (p) => fs.mkdirSync(path.join(root, p), { recursive: true });
  for (const f of ['a', 'b', 'f']) {
    w(f);
  }
  d('e');
  for (const p of ['d/s2', 'd/s3', 'd/s1/g', 'sub/m', 'ro', 'noperm']) {
    d(p);
  }
  for (const f of ['d/a', 'd/b', 'd/s2/z', 'd/s1/x', 'd/s1/g/y']) {
    w(f);
  }
  for (const f of ['sub/k', 'sub/m/n', 'ro/f', 'noperm/f']) {
    w(f);
  }
  d('p/pp');
  w('p/pp/f');
  d('p/r');
  w('p/r/h');
  w('p/q');
  // A deeper/wider tree.
  for (let i = 0; i < 4; i++) {
    d(`big/l${i}/m${i}/n${i}`);
    for (let j = 0; j < 3; j++) {
      w(`big/l${i}/f${j}`);
      w(`big/l${i}/m${i}/g${j}`);
    }
  }
  d('wide');
  for (let i = 0; i < 30; i++) {
    w(`wide/f${i}`);
  }
  fs.symlinkSync('d', path.join(root, 'l'));
  fs.symlinkSync('a', path.join(root, 'fl'));
  fs.symlinkSync('nowhere', path.join(root, 'dangling'));
  fs.chmodSync(path.join(root, 'ro'), 0o555);
  fs.chmodSync(path.join(root, 'noperm'), 0o000);
}

/** Make every directory under `dir` writable again, then remove it. */
function resetTree(dir) {
  if (!fs.existsSync(path.join(dir, 'w'))) {
    return;
  }
  fixPerms(path.join(dir, 'w'));
  fs.rmSync(path.join(dir, 'w'), { recursive: true, force: true });
}

function fixPerms(dir) {
  fs.chmodSync(dir, 0o755);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      fixPerms(path.join(dir, ent.name));
    }
  }
}

/** Sorted listing (type, mode, link target) of what is left of the tree. */
function listTree() {
  const out = [];
  const walk = (dir, rel) => {
    const st = fs.lstatSync(dir);
    const mode = (st.mode & 0o777).toString(8);
    if (st.isSymbolicLink()) {
      out.push(`${rel} -> ${fs.readlinkSync(dir)}`);
      return;
    }
    if (!st.isDirectory()) {
      out.push(`${rel} f ${mode}`);
      return;
    }
    out.push(`${rel}/ ${mode}`);
    fs.chmodSync(dir, 0o755);
    for (const name of fs.readdirSync(dir).sort()) {
      walk(path.join(dir, name), `${rel}/${name}`);
    }
  };
  if (fs.existsSync(root)) {
    walk(root, '.');
  }
  return out.join(' ');
}

function resolveArgs(args) {
  return args.map((a) => (a.startsWith('@/') ? root + a.slice(1) : a));
}

function resolveCwd(cwd = '.') {
  return path.isAbsolute(cwd) ? cwd : path.join(root, cwd);
}

function bunCommand(args, mode) {
  switch (mode) {
    case 'out':
      return Bun.$`rm ${args} > ${outFile}`;
    case 'err':
      return Bun.$`rm ${args} 2> ${outFile}`;
    case 'fullout':
      return Bun.$`rm ${args} > /dev/full`;
    case 'fullerr':
      return Bun.$`rm ${args} 2> /dev/full`;
    default:
      return Bun.$`rm ${args}`;
  }
}

function readOut() {
  return fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
}

async function runBun(args, cwd, mode) {
  makeFixture();
  fs.rmSync(outFile, { force: true });
  const r = await bunCommand(args, mode).cwd(cwd).nothrow().quiet();
  const out = mode === 'out' ? readOut() : r.stdout.toString();
  const err = mode === 'err' ? readOut() : r.stderr.toString();
  return JSON.stringify([r.exitCode, out, err, listTree()]);
}

async function runJs(args, cwd, mode) {
  makeFixture();
  fs.rmSync(outFile, { force: true });
  const shell = new ShellExecEnv({
    cwd,
    exportEnv: envMapFromObject(process.env),
  });
  let fd = null;
  if (mode === 'out' || mode === 'err') {
    fd = fs.openSync(outFile, 'w');
  } else if (mode !== 'buf') {
    fd = fs.openSync('/dev/full', 'w');
  }
  const fdOut = {
    kind: 'fd',
    writer: fd === null ? null : new Writer(new FdTarget(fd)),
    captured: null,
  };
  const toStdout = mode === 'out' || mode === 'fullout';
  const toStderr = mode === 'err' || mode === 'fullerr';
  const b = new Builtin({
    kind: 'rm',
    args,
    shell,
    stdin: { kind: 'ignore' },
    stdout: toStdout ? fdOut : { kind: 'buf', target: 'stdout' },
    stderr: toStderr ? fdOut : { kind: 'buf', target: 'stderr' },
  });
  const code = await rm(b);
  if (fd !== null) {
    fs.closeSync(fd);
  }
  const out = mode === 'out' ? readOut() : shell.bufferedStdout.toString();
  const err = mode === 'err' ? readOut() : shell.bufferedStderr.toString();
  return JSON.stringify([code, out, err, listTree()]);
}

const clip = (s) => (s.length > 400 ? `${s.slice(0, 400)}...` : s);

/** Same result except for the order of the stdout lines. */
function sameButOrder(a, b) {
  const [ca, oa, ea, ta] = JSON.parse(a);
  const [cb, ob, eb, tb] = JSON.parse(b);
  const sorted = (s) => s.split('\n').sort().join('\n');
  return ca === cb && ea === eb && ta === tb && sorted(oa) === sorted(ob);
}

let same = 0;
let reordered = 0;
let varied = 0;
const diffs = [];
for (const [probe, cwdRel] of PROBES) {
  const args = resolveArgs(probe);
  const cwd = resolveCwd(cwdRel);
  for (const mode of MODES) {
    const seen = new Set();
    for (let i = 0; i < RUNS; i++) {
      seen.add(await runBun(args, cwd, mode));
    }
    const js = await runJs(args, cwd, mode);
    if (seen.size > 1) {
      varied++;
    }
    if (seen.has(js)) {
      same++;
    } else if ([...seen].some((b) => sameButOrder(js, b))) {
      reordered++;
    } else {
      diffs.push({
        probe: clip(JSON.stringify(probe)),
        cwdRel,
        mode,
        js,
        bun: [...seen],
      });
    }
  }
}
resetTree(base);
fs.rmSync(base, { recursive: true, force: true });

const label = (s) => clip(s.replaceAll(root, '<root>'));
for (const d of diffs) {
  console.log(`DIFF ${d.probe} cwd=${d.cwdRel ?? '.'} mode=${d.mode}`);
  console.log(`  js : ${label(d.js)}`);
  for (const b of d.bun) {
    console.log(`  bun: ${label(b)}`);
  }
}
const total = PROBES.length * MODES.length;
console.log(
  `${PROBES.length} probes x ${MODES.length} modes = ${total}: ${same} identical, ` +
    `${reordered} same but stdout line order, ${diffs.length} different ` +
    `(${varied} with nondeterministic Bun output)`
);
