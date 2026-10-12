// Differential test of the JS mv/cat/cp builtins against Bun's.
//
//   BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1 bun experiments/issue-27/mv-cat-cp-diff.mjs
//
// (cat and cp are only builtins in Bun with that variable set.)
//
// Every case runs in each of its output modes: buffered, or stdout, stderr or
// both redirected to a file. Each run gets a fresh, identical fixture dir
// ($D), plus a fixture dir on /dev/shm ($S), which is another device, for
// the cross-device mv paths. The case runs three ways: with Bun.$, with the
// JS port in-process under Bun, and with the JS port under Node (a child
// `node` running this script in `port` mode). The results must match: the
// exit code, stdout, stderr, the redirect file and both fixture trees (types,
// modes, contents and symlink targets).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Builtin } from '../../js/src/bun-shell/builtin.mjs';
import { cat } from '../../js/src/bun-shell/builtins/cat.mjs';
import { cp } from '../../js/src/bun-shell/builtins/cp.mjs';
import { mv } from '../../js/src/bun-shell/builtins/mv.mjs';
import { ShellExecEnv, envMapFromObject } from '../../js/src/bun-shell/env.mjs';
import {
  Channel,
  FdTarget,
  Reader,
  Writer,
} from '../../js/src/bun-shell/io.mjs';

const BUILTINS = { mv, cat, cp };
const ALL = ['buf', 'stdout', 'stderr', 'both'];
// Bun hangs when cat has file operands and stdout is a file.
const NO_STDOUT = ['buf', 'stderr'];

// [kind, args, {cwd, stdin, modes}]. stdin: {buf: string} (a Buffer, which
// Bun 1.4.2 cannot combine with another redirect, so buffered mode only),
// {pipe: string} (`echo -n ... |`) or {file: name} (`< file`).
const CASES = [
  // mv: options
  ['mv', []],
  ['mv', ['a']],
  ['mv', ['-f']],
  ['mv', ['-f', 'f']],
  ['mv', ['-x', 'f', 'g']],
  ['mv', ['-fx', 'f', 'g']],
  ['mv', ['--', 'f', 'g']],
  ['mv', ['--force', 'f', 'g']],
  ['mv', ['-f', 'f', 'g']],
  ['mv', ['-fhinv', 'f', 'g']],
  ['mv', ['-', 'f', 'g']],
  ['mv', ['-', 'f']],
  ['mv', ['f', '-f', 'd']],
  // mv: one source
  ['mv', ['f', 'g']],
  ['mv', ['f', 'ex']],
  ['mv', ['f', 'd']],
  ['mv', ['f', 'd/']],
  ['mv', ['f', 'ld']],
  ['mv', ['f', 'lf']],
  ['mv', ['lf', 'g']],
  ['mv', ['lf', 'd']],
  ['mv', ['dangling', 'g']],
  ['mv', ['f', 'nodir/']],
  ['mv', ['f', 'nodir/x']],
  ['mv', ['f', 'g/']],
  ['mv', ['f', 'f']],
  ['mv', ['f', './f']],
  ['mv', ['f', 'd/x']],
  ['mv', ['missing', 'g']],
  ['mv', ['missing', 'd']],
  ['mv', ['./missing', './d/']],
  ['mv', ['d', 'e']],
  ['mv', ['d/', 'e']],
  ['mv', ['d/', 'f']],
  ['mv', ['d', 'f']],
  ['mv', ['d', 'd']],
  ['mv', ['d', 'd/s']],
  ['mv', ['d', 'empty-d']],
  ['mv', ['d/s', 'full-d']],
  ['mv', ['f', 'ro']],
  ['mv', ['ro/in', 'g']],
  ['mv', ['d', 'ro/x']],
  ['mv', ['', 'g']],
  ['mv', ['f', '']],
  ['mv', ['', 'd']],
  ['mv', ['$D/f', '$D/g']],
  ['mv', ['$D/f', 'd']],
  ['mv', ['f', '$D/d/']],
  ['mv', ['../f', 'up'], { cwd: 'd' }],
  ['mv', ['x', '..'], { cwd: 'd' }],
  // mv: several sources
  ['mv', ['f', 'ex', 'd']],
  ['mv', ['f', 'ex', 'g']],
  ['mv', ['f', 'ex', 'lf']],
  ['mv', ['f', 'ex', 'nodir/']],
  ['mv', ['f', 'missing', 'ex', 'd']],
  ['mv', ['m1', 'm2', 'nodir']],
  ['mv', ['f', 'ex', 'big', 'empty', 'lf', 'dangling', 'ld', 'd']],
  // m1 fails in batch 1; how far batch 2 gets before error_signal is a race.
  [
    'mv',
    ['f', 'm1', 'ex', 'big', 'empty', 'lf', 'dangling', 'ld', 'd'],
    { racyFs: true },
  ],
  // Two batches run concurrently in Bun: which sources of the first batch get
  // moved before the second batch's error stops it is a race.
  [
    'mv',
    ['f', 'ex', 'big', 'empty', 'lf', 'm1', 'ld', 'dangling', 'd'],
    { racyFs: true },
  ],
  ['mv', ['f', 'f', 'd']],
  ['mv', ['f', 'd/x', 'e/', 'd']],
  // mv: across devices
  ['mv', ['f', '$S/f2']],
  ['mv', ['f', '$S/t']],
  ['mv', ['f', '$S/t/']],
  ['mv', ['f', '$S/tf']],
  ['mv', ['f', '$S/nodir/x']],
  ['mv', ['ex', 'big', 'empty', '$S/t']],
  ['mv', ['lf', '$S/lf']],
  ['mv', ['dangling', '$S/t']],
  ['mv', ['d', '$S/nd']],
  ['mv', ['d', '$S/t']],
  ['mv', ['d', '$S/tf']],
  ['mv', ['d', '$S/u']],
  ['mv', ['d2', '$S/nd']],
  ['mv', ['d2', '$S/t']],
  ['mv', ['pipe', '$S/p']],
  ['mv', ['pipe', '$S/t']],
  ['mv', ['p0', '$S/p0']],
  ['mv', ['ro/in', '$S/t']],
  ['mv', ['$S/tf', 'g']],
  ['mv', ['$S/u', 'e']],
  ['mv', ['$S/u', 'd']],
  // cat: options
  ['cat', ['-n', 'f']],
  ['cat', ['-b']],
  ['cat', ['-e', 'f']],
  ['cat', ['-s']],
  ['cat', ['-t']],
  ['cat', ['-u']],
  ['cat', ['-v']],
  ['cat', ['-x']],
  ['cat', ['-xyz', 'f']],
  ['cat', ['-nx', 'f']],
  ['cat', ['-xn', 'f']],
  ['cat', ['-']],
  ['cat', ['--']],
  ['cat', ['--', 'f']],
  ['cat', ['--number']],
  ['cat', ['-é']],
  ['cat', ['-éx']],
  // cat: files (Bun cannot read regular files: exit 1, no output)
  ['cat', ['f'], { modes: NO_STDOUT }],
  ['cat', ['f', 'g'], { modes: NO_STDOUT }],
  ['cat', ['missing'], { modes: ALL }],
  ['cat', ['missing', 'f'], { modes: ALL }],
  ['cat', ['f', 'missing'], { modes: NO_STDOUT }],
  ['cat', ['d'], { modes: NO_STDOUT }],
  ['cat', ['p0'], { modes: ALL }],
  ['cat', ['ro/in'], { modes: NO_STDOUT }],
  ['cat', ['dangling'], { modes: ALL }],
  ['cat', ['nodir/x'], { modes: ALL }],
  ['cat', ['f/x'], { modes: ALL }],
  ['cat', [''], { modes: ALL }],
  ['cat', ['$D/missing'], { modes: ALL }],
  ['cat', ['../missing'], { cwd: 'd', modes: ALL }],
  ['cat', ['/dev/null'], { modes: NO_STDOUT }],
  ['cat', ['/dev/zero'], { modes: NO_STDOUT }],
  // cat: stdin
  ['cat', [], { stdin: { buf: 'from a buffer\n' } }],
  ['cat', [], { stdin: { buf: '' } }],
  ['cat', ['-'], { stdin: { buf: 'x' } }],
  ['cat', ['missing'], { stdin: { buf: 'x' } }],
  ['cat', [], { stdin: { pipe: 'piped\n' }, modes: ALL }],
  ['cat', [], { stdin: { pipe: 'a'.repeat(200000) }, modes: ALL }],
  ['cat', [], { stdin: { pipe: '' }, modes: ALL }],
  ['cat', ['missing'], { stdin: { pipe: 'x' }, modes: ALL }],
  ['cat', ['f'], { stdin: { pipe: 'x' }, modes: NO_STDOUT }],
  ['cat', [], { stdin: { file: 'f' } }],
  ['cat', [], { stdin: { file: 'empty' } }],
  // cp: options
  ['cp', []],
  ['cp', ['f']],
  ['cp', ['-R']],
  ['cp', ['-R', 'f']],
  ['cp', ['-x']],
  ['cp', ['-x', 'f', 'g']],
  ['cp', ['-Rx', 'f', 'g']],
  ['cp', ['-xR', 'f', 'g']],
  ['cp', ['-f', 'f', 'g']],
  ['cp', ['-H', 'f', 'g']],
  ['cp', ['-i', 'f', 'g']],
  ['cp', ['-L', 'f', 'g']],
  ['cp', ['-P', 'f', 'g']],
  ['cp', ['-p', 'f', 'g']],
  ['cp', ['-a', 'f', 'g']],
  ['cp', ['-n', 'f', 'g']],
  ['cp', ['-nv', 'f', 'g']],
  ['cp', ['-vn', 'f', 'g']],
  ['cp', ['-v', '-n', 'f', 'g']],
  ['cp', ['-', 'f', 'g']],
  ['cp', ['--', 'f', 'g']],
  ['cp', ['--recursive', 'd', 'e']],
  ['cp', ['-é', 'f', 'g']],
  ['cp', ['f', '-v', 'g']],
  // cp: files
  ['cp', ['-v', 'f', 'g']],
  ['cp', ['-v', 'f', 'ex']],
  ['cp', ['-v', 'ex', 'g']],
  ['cp', ['-v', 'big', 'f']],
  ['cp', ['-v', 'empty', 'big']],
  ['cp', ['-v', 'f', 'd']],
  ['cp', ['-v', 'f', 'd/']],
  ['cp', ['-v', 'f', 'ld']],
  ['cp', ['-v', 'f', 'lf']],
  ['cp', ['-v', 'lf', 'g']],
  ['cp', ['-v', 'lf', 'd']],
  ['cp', ['-v', 'd/rl', 'g']],
  ['cp', ['-v', 'dangling', 'g']],
  ['cp', ['-v', 'lf', 'dangling']],
  ['cp', ['-v', 'f', 'dangling']],
  ['cp', ['-v', 'f', 'f']],
  ['cp', ['-v', 'f', './f']],
  ['cp', ['-v', 'f', '$D/f']],
  ['cp', ['-v', 'lf', 'lf']],
  ['cp', ['-v', 'f', 'nodir/']],
  ['cp', ['-v', 'f', 'nodir/sub/g']],
  ['cp', ['-v', 'f', 'd/x/y']],
  ['cp', ['-v', 'f', 'f/']],
  ['cp', ['-v', 'f', 'g/']],
  ['cp', ['-v', 'missing', 'g']],
  ['cp', ['-v', 'p0', 'g']],
  ['cp', ['-v', 'f', 'p0']],
  ['cp', ['-v', 'f', 'ro/new']],
  ['cp', ['-v', 'f', 'ro/in']],
  ['cp', ['-v', 'f', 'ro/sub/new']],
  ['cp', ['-v', '/dev/null', 'g']],
  ['cp', ['-v', 'd', 'e']],
  ['cp', ['-v', 'd', 'f']],
  ['cp', ['-v', '', 'g']],
  ['cp', ['-v', 'f', '']],
  ['cp', ['-v', '$D/f', '$D/g']],
  ['cp', ['-v', '../f', '.'], { cwd: 'd' }],
  ['cp', ['-v', 'f', '$S/f2']],
  ['cp', ['-v', 'f', '$S/t']],
  // cp: several sources
  ['cp', ['-v', 'f', 'ex', 'd']],
  ['cp', ['-v', 'f', 'ex', 'g']],
  ['cp', ['-v', 'f', 'ex', 'g/']],
  ['cp', ['-v', 'f', 'ex', 'lf']],
  ['cp', ['-v', 'f', 'missing', 'ex', 'd']],
  ['cp', ['-v', 'f', 'd', 'e']],
  ['cp', ['-v', 'f', 'd', 'e/']],
  ['cp', ['-v', 'f', 'd', 'e', 'ex', 'nodir']],
  ['cp', ['-v', 'f', 'f', 'd']],
  ['cp', ['-v', 'f', 'd/x', 'd']],
  ['cp', ['-v', 'f', 'p0', 'lf', 'd']],
  // cp -R
  ['cp', ['-R', 'd', 'e']],
  ['cp', ['-v', '-R', 'd', 'e']],
  ['cp', ['-R', '-v', 'd/', 'e']],
  ['cp', ['-R', '-v', 'd', 'empty-d']],
  ['cp', ['-R', '-v', 'd', 'full-d']],
  ['cp', ['-R', '-v', 'd/s', 'full-d']],
  ['cp', ['-R', '-v', 'd', 'e/sub']],
  ['cp', ['-R', '-v', 'd', 'f']],
  ['cp', ['-R', '-v', 'd', 'lf']],
  ['cp', ['-R', '-v', 'ld', 'e']],
  ['cp', ['-R', '-v', 'f', 'g']],
  ['cp', ['-R', '-v', 'f', 'd']],
  ['cp', ['-R', '-v', 'f', 'nodir/']],
  ['cp', ['-R', '-v', 'f', 'd/x', 'e']],
  ['cp', ['-R', '-v', 'f', 'd/x', 'd/s']],
  ['cp', ['-R', '-v', 'd/s', '.']],
  ['cp', ['-R', '-v', 'd2', 'e']],
  ['cp', ['-R', '-v', 'd', 'ro/x']],
  ['cp', ['-R', '-v', 'd', '$S/nd']],
  ['cp', ['-R', '-v', 'd', '$S/t']],
  ['cp', ['-R', '-v', 'ro', 'e']],
  ['cp', ['-R', '-v', 'missing', 'e']],
  ['cp', ['-R', '-v', 'd', '']],
];

function setupFixture(dir, shm) {
  const w = (rel, data, mode) => {
    fs.writeFileSync(path.join(dir, rel), data);
    if (mode !== undefined) {
      fs.chmodSync(path.join(dir, rel), mode);
    }
  };
  fs.mkdirSync(path.join(dir, 'd/s'), { recursive: true });
  w('f', 'hello\n');
  w('g0', 'other\n');
  w('ex', '#!/bin/sh\n', 0o754);
  w(
    'big',
    crypto
      .createHash('sha512')
      .update('x')
      .digest()
      .toString('hex')
      .repeat(3000)
  );
  w('empty', '');
  w('d/x', 'x\n', 0o640);
  w('d/s/y', 'y\n');
  fs.symlinkSync('../f', path.join(dir, 'd/rl'));
  fs.symlinkSync('f', path.join(dir, 'lf'));
  fs.symlinkSync('d', path.join(dir, 'ld'));
  fs.symlinkSync('nowhere', path.join(dir, 'dangling'));
  fs.mkdirSync(path.join(dir, 'empty-d'));
  fs.mkdirSync(path.join(dir, 'full-d/d'), { recursive: true });
  w('full-d/d/keep', 'keep\n');
  w('full-d/s', 'file named s\n');
  fs.mkdirSync(path.join(dir, 'd2'));
  w('d2/a', 'a\n', 0o000);
  w('d2/b', 'b\n');
  fs.chmodSync(path.join(dir, 'd2'), 0o750);
  w('p0', 'secret\n', 0o000);
  fs.mkdirSync(path.join(dir, 'ro'));
  w('ro/in', 'in\n');
  fs.chmodSync(path.join(dir, 'ro'), 0o555);
  spawnSync('mkfifo', [path.join(dir, 'pipe')]);
  fs.mkdirSync(path.join(shm, 't'));
  fs.mkdirSync(path.join(shm, 'u/d'), { recursive: true });
  fs.writeFileSync(path.join(shm, 'u/d/z'), 'z\n');
  fs.writeFileSync(path.join(shm, 'tf'), 'tf\n');
}

function unlockTree(dir) {
  const walk = (p) => {
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (!st.isDirectory()) {
      return;
    }
    fs.chmodSync(p, 0o755);
    for (const e of fs.readdirSync(p)) {
      walk(path.join(p, e));
    }
  };
  walk(dir);
}

function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    const p = rel === '.' ? dir : path.join(dir, rel);
    let st;
    try {
      st = fs.lstatSync(p);
    } catch (e) {
      out[rel] = `lstat:${e.code}`;
      return;
    }
    const e = {
      type: st.isDirectory()
        ? 'dir'
        : st.isSymbolicLink()
          ? 'link'
          : st.isFIFO()
            ? 'fifo'
            : st.isFile()
              ? 'file'
              : 'other',
      mode: (st.mode & 0o7777).toString(8),
    };
    if (e.type === 'file') {
      const old = st.mode & 0o7777;
      fs.chmodSync(p, old | 0o400);
      const data = fs.readFileSync(p);
      fs.chmodSync(p, old);
      e.content =
        data.length < 100
          ? data.toString()
          : `${data.length}:${crypto.createHash('sha1').update(data).digest('hex')}`;
    }
    if (e.type === 'link') {
      e.target = fs.readlinkSync(p);
    }
    out[rel] = e;
    if (e.type === 'dir') {
      for (const n of fs.readdirSync(p).sort()) {
        walk(rel === '.' ? n : path.join(rel, n));
      }
    }
  };
  walk('.');
  return out;
}

function makeSubst(dir, shm) {
  return (s) => s.replaceAll('$D', dir).replaceAll('$S', shm);
}

function makeNorm(dir, shm) {
  return (s) => s.replaceAll(shm, '$S').replaceAll(dir, '$D');
}

async function runPort(c, env) {
  const [kind, args, opts = {}] = c;
  const shell = new ShellExecEnv({
    cwd: env.cwd,
    exportEnv: envMapFromObject(process.env),
  });
  const io = {
    stdout: { kind: 'buf', target: 'stdout' },
    stderr: { kind: 'buf', target: 'stderr' },
    stdin: { kind: 'ignore' },
  };
  let fd = null;
  if (env.mode !== 'buf') {
    fd = fs.openSync(env.out, 'w');
    const w = new Writer(new FdTarget(fd, { owned: false }));
    for (const which of env.mode === 'both'
      ? ['stdout', 'stderr']
      : [env.mode]) {
      io[which] = { kind: 'fd', writer: w, captured: null };
    }
  }
  let reader = null;
  const stdin = opts.stdin;
  if (stdin?.buf !== undefined) {
    io.stdin = { kind: 'arraybuf', bytes: Buffer.from(stdin.buf) };
  } else if (stdin?.pipe !== undefined) {
    const ch = new Channel();
    if (stdin.pipe.length > 0) {
      ch.write(Buffer.from(stdin.pipe)).catch(() => {});
    }
    ch.close();
    reader = new Reader({ type: 'channel', channel: ch });
    io.stdin = { kind: 'fd', reader };
  } else if (stdin?.file !== undefined) {
    const sfd = fs.openSync(path.join(env.cwd, stdin.file), 'r');
    reader = new Reader({ type: 'fd', fd: sfd, owned: true });
    io.stdin = { kind: 'fd', reader };
  }
  const b = new Builtin({ kind, args: args.map(env.subst), shell, ...io });
  const code = await BUILTINS[kind](b);
  reader?.deref();
  await io.stdout.writer?.tail;
  await io.stderr.writer?.tail;
  if (fd !== null) {
    fs.closeSync(fd);
  }
  return {
    code,
    stdout: shell.bufferedStdout.toString(),
    stderr: shell.bufferedStderr.toString(),
  };
}

async function runBun(c, env) {
  const [kind, args, opts = {}] = c;
  const a = args.map(env.subst);
  const out = env.out;
  const stdin = opts.stdin;
  let p;
  if (stdin?.buf !== undefined) {
    p = Bun.$`${kind} ${a} < ${Buffer.from(stdin.buf)}`;
  } else if (stdin?.file !== undefined) {
    p = Bun.$`${kind} ${a} < ${stdin.file}`;
  } else {
    const pre = stdin?.pipe !== undefined ? ['echo', '-n', stdin.pipe] : null;
    if (env.mode === 'buf') {
      p = pre ? Bun.$`${pre} | ${kind} ${a}` : Bun.$`${kind} ${a}`;
    } else if (env.mode === 'stdout') {
      p = pre
        ? Bun.$`${pre} | ${kind} ${a} > ${out}`
        : Bun.$`${kind} ${a} > ${out}`;
    } else if (env.mode === 'stderr') {
      p = pre
        ? Bun.$`${pre} | ${kind} ${a} 2> ${out}`
        : Bun.$`${kind} ${a} 2> ${out}`;
    } else {
      p = pre
        ? Bun.$`${pre} | ${kind} ${a} &> ${out}`
        : Bun.$`${kind} ${a} &> ${out}`;
    }
  }
  const r = await p.cwd(env.cwd).nothrow().quiet();
  return {
    code: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  };
}

function modesOf(c) {
  const opts = c[2] ?? {};
  if (opts.modes) {
    return opts.modes;
  }
  if (opts.stdin?.buf !== undefined || opts.stdin?.file !== undefined) {
    return ['buf'];
  }
  // Bun hangs on `cat <files> > out`.
  if (c[0] === 'cat' && c[1].some((a) => !a.startsWith('-'))) {
    return NO_STDOUT;
  }
  return ALL;
}

async function runSide(runner, root, tag) {
  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    for (const mode of modesOf(c)) {
      const base = path.join(root, `${tag}-${i}-${mode}`);
      const dir = path.join(base, 'fx');
      const ioDir = path.join(base, 'io');
      const shm = fs.mkdtempSync(path.join(SHM_ROOT, `${tag}-${i}-${mode}-`));
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(ioDir);
      setupFixture(dir, shm);
      const env = {
        cwd: c[2]?.cwd ? path.join(dir, c[2].cwd) : dir,
        mode,
        out: path.join(ioDir, 'out'),
        subst: makeSubst(dir, shm),
      };
      const norm = makeNorm(dir, shm);
      const r = await runner(c, env);
      let file = null;
      try {
        file = norm(fs.readFileSync(env.out, 'utf8'));
      } catch {
        // Not redirected.
      }
      results.push({
        code: r.code,
        stdout: norm(r.stdout),
        stderr: norm(r.stderr),
        file,
        fs: JSON.parse(norm(JSON.stringify(snapshot(dir)))),
        shm: JSON.parse(norm(JSON.stringify(snapshot(shm)))),
      });
      unlockTree(base);
      unlockTree(shm);
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(shm, { recursive: true, force: true });
    }
  }
  return results;
}

const SHM_ROOT = fs.mkdtempSync(
  path.join('/dev/shm', `mcc-${process.argv[2] ?? 'main'}-`)
);
const self = fileURLToPath(import.meta.url);

try {
  if (process.argv[2] === 'port') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-diff-node-'));
    const r = await runSide(runPort, root, 'node');
    fs.rmSync(root, { recursive: true, force: true });
    fs.writeFileSync(process.argv[3], JSON.stringify(r));
  } else {
    if (typeof Bun === 'undefined') {
      throw new Error('run under bun');
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-diff-'));
    const bun = await runSide(runBun, root, 'bun');
    const portBun = await runSide(runPort, root, 'portbun');
    const jsonOut = path.join(root, 'node.json');
    const child = spawnSync('node', [self, 'port', jsonOut], {
      stdio: 'inherit',
    });
    if (child.status !== 0) {
      throw new Error('node port run failed');
    }
    const portNode = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
    fs.rmSync(root, { recursive: true, force: true });
    // Bun copies the files of a `cp -R` concurrently, so its -v lines come
    // in completion order; fall back to comparing sorted lines.
    const sortLines = (s) =>
      typeof s === 'string'
        ? s
            .split(/(?<=\n)/)
            .sort()
            .join('')
        : s;
    const unordered = (r) =>
      JSON.stringify({
        ...r,
        stdout: sortLines(r.stdout),
        stderr: sortLines(r.stderr),
        file: sortLines(r.file),
      });
    let n = 0;
    let diffs = 0;
    let orderOnly = 0;
    let k = 0;
    for (const c of CASES) {
      for (const mode of modesOf(c)) {
        if (c[2]?.racyFs) {
          for (const side of [bun, portBun, portNode]) {
            delete side[k].fs;
          }
        }
        const want = JSON.stringify(bun[k]);
        for (const [label, side] of [
          ['port(bun)', portBun],
          ['port(node)', portNode],
        ]) {
          n++;
          const got = JSON.stringify(side[k]);
          if (got === want) {
            continue;
          }
          if (unordered(side[k]) === unordered(bun[k])) {
            orderOnly++;
            continue;
          }
          diffs++;
          const short = (s) => (s.length > 900 ? `${s.slice(0, 900)}...` : s);
          console.log(`DIFF ${label} ${JSON.stringify(c)} mode=${mode}`);
          console.log(`  bun:  ${short(want)}`);
          console.log(`  port: ${short(got)}`);
        }
        k++;
      }
    }
    console.log(
      `${k} runs (${CASES.length} cases x output modes), ${n} comparisons (x 2 runtimes), ${diffs} differences, ${orderOnly} line-order-only (Bun concurrency)`
    );
  }
} finally {
  fs.rmSync(SHM_ROOT, { recursive: true, force: true });
}
