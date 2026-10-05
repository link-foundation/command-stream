// Differential test of the JS mkdir/touch builtins against Bun's.
//
//   bun experiments/issue-27/mkdir-touch-diff.mjs
//
// For every case and every output mode (buffered; stdout, stderr or both
// redirected to a file) the case is run in a fresh, identical fixture
// dir with Bun.$, with the JS port in-process (under Bun) and with the JS port
// under Node (a child `node` running this script in `port` mode). The exit
// code, stdout, stderr and the resulting fixture tree (types, modes, sizes,
// symlink targets, and whether each mtime/atime is untouched or "new") must
// be identical.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Builtin } from '../../js/src/bun-shell/builtin.mjs';
import { mkdir } from '../../js/src/bun-shell/builtins/mkdir.mjs';
import { touch } from '../../js/src/bun-shell/builtins/touch.mjs';
import { ShellExecEnv, envMapFromObject } from '../../js/src/bun-shell/env.mjs';
import { Writer, FdTarget } from '../../js/src/bun-shell/io.mjs';

const OLD_SECS = 946684800;
const A300 = 'a'.repeat(300);
const A5000 = 'a'.repeat(5000);

const CASES = [
  // mkdir: options
  ['mkdir', []],
  ['mkdir', ['-p']],
  ['mkdir', ['-v']],
  ['mkdir', ['-pv']],
  ['mkdir', ['-x']],
  ['mkdir', ['-px', 'a']],
  ['mkdir', ['-pxy', 'a']],
  ['mkdir', ['--verbose', 'a']],
  ['mkdir', ['--vebose', 'a']],
  ['mkdir', ['--parents', '-v', 'a/b']],
  ['mkdir', ['--parents=1', 'a/b']],
  ['mkdir', ['--', 'a']],
  ['mkdir', ['-', 'a']],
  ['mkdir', ['-m', '755', 'a']],
  ['mkdir', ['-pm', 'a']],
  ['mkdir', ['-vm', 'a']],
  ['mkdir', ['--mode', 'a']],
  ['mkdir', ['--mode=7', 'a']],
  ['mkdir', ['-é', 'a']],
  ['mkdir', ['-péx', 'a']],
  ['mkdir', ['a', '-p']],
  ['mkdir', ['-v', 'a', '-p', '--', '-x']],
  // mkdir: operands
  ['mkdir', ['a']],
  ['mkdir', ['-v', 'a']],
  ['mkdir', ['a/b']],
  ['mkdir', ['-v', 'a/b']],
  ['mkdir', ['-p', 'a/b/c']],
  ['mkdir', ['-pv', 'a/b/c']],
  ['mkdir', ['-pv', 'dir/sub/x/y']],
  ['mkdir', ['-pv', 'dir']],
  ['mkdir', ['-v', 'dir']],
  ['mkdir', ['-p', 'file']],
  ['mkdir', ['-v', 'file']],
  ['mkdir', ['-p', 'file/x']],
  ['mkdir', ['file/x']],
  ['mkdir', ['-pv', 'file/x/y']],
  ['mkdir', ['-pv', 'ro/x']],
  ['mkdir', ['-v', 'ro/x']],
  ['mkdir', ['-pv', 'ro/x/y']],
  ['mkdir', ['-pv', 'noexec/x/y']],
  ['mkdir', ['-v', 'noexec/x']],
  ['mkdir', ['-pv', '$D/abs//x/./y/']],
  ['mkdir', ['-v', '$D/abs2/']],
  ['mkdir', ['-v', '$D/./abs3']],
  ['mkdir', ['-pv', '$D/abs4/../abs5/q']],
  ['mkdir', ['-pv', 'rel//x/./y/../z/']],
  ['mkdir', ['-v', 'rel2/', 'rel3//', './rel4/.']],
  ['mkdir', ['-v', 'a', 'a', 'b', 'file', 'c', 'nodir/x', 'd']],
  ['mkdir', ['-pv', 'a', 'a', 'b/c', 'file/x', 'b/c/d']],
  ['mkdir', ['-pv', 'linkdir']],
  ['mkdir', ['-pv', 'linkdir/new/deeper']],
  ['mkdir', ['-v', 'linkfile']],
  ['mkdir', ['-p', 'linkfile']],
  ['mkdir', ['-p', 'dangling']],
  ['mkdir', ['-v', 'dangling']],
  ['mkdir', ['-pv', '']],
  ['mkdir', ['-v', '']],
  ['mkdir', ['-v', '.']],
  ['mkdir', ['-pv', '.']],
  ['mkdir', ['-pv', '..']],
  ['mkdir', ['-pv', '/']],
  ['mkdir', ['-v', '/']],
  ['mkdir', ['-v', A300]],
  ['mkdir', ['-pv', A300]],
  ['mkdir', ['-pv', `p1/p2/${A300}/z`]],
  ['mkdir', ['-v', A5000]],
  ['mkdir', ['-pv', A5000]],
  ['mkdir', ['-v', A5000, 'short']],
  ['mkdir', ['-v', `$D/${A5000}`]],
  ['mkdir', ['-v', `${'./'.repeat(3000)}normalized`]],
  ['mkdir', ['-v', `$D/${'./'.repeat(3000)}as-written`]],
  ['mkdir', ['-pv', `${'x/'.repeat(1000)}end`]],
  ['mkdir', ['-pv', '../up/x'], 'dir'],
  ['mkdir', ['-v', '../../../../../../../../../../../../tmp'], 'dir'],
  ['mkdir', ['-v', 'sp ace', 'new\nline', 'ünïcödé']],
  // touch: options
  ['touch', []],
  ['touch', ['-c', 'f']],
  ['touch', ['-a', 'f']],
  ['touch', ['-h']],
  ['touch', ['-m', 'f']],
  ['touch', ['-r', 'file', 'f']],
  ['touch', ['-t', '200001010000', 'f']],
  ['touch', ['-d', 'x', 'f']],
  ['touch', ['-A', 'f']],
  ['touch', ['-x', 'f']],
  ['touch', ['-xc', 'f']],
  ['touch', ['-cx', 'f']],
  ['touch', ['--time', 'f']],
  ['touch', ['--no-create', 'f']],
  ['touch', ['--date', 'f']],
  ['touch', ['--reference', 'f']],
  ['touch', ['--reference=x', 'f']],
  ['touch', ['--date=1', 'f']],
  ['touch', ['--foo']],
  ['touch', ['-']],
  ['touch', ['--']],
  ['touch', ['--', 'f']],
  ['touch', ['-é']],
  ['touch', ['f', '-c']],
  // touch: operands
  ['touch', ['new']],
  ['touch', ['file']],
  ['touch', ['old']],
  ['touch', ['dir']],
  ['touch', ['dir/']],
  ['touch', ['nodir/f']],
  ['touch', ['file/x']],
  ['touch', ['file/']],
  ['touch', ['newf/']],
  ['touch', ['$D/./t1/../t2']],
  ['touch', ['$D//abs2']],
  ['touch', ['$D/file/']],
  ['touch', ['linkfile']],
  ['touch', ['linkdir']],
  ['touch', ['dangling']],
  ['touch', ['ro/x']],
  ['touch', ['ro']],
  ['touch', ['ro/.']],
  ['touch', ['noexec/x']],
  ['touch', ['/etc/passwd']],
  ['touch', ['new1', 'nodir/x', 'new2', 'file/x', 'old', 'new1']],
  ['touch', ['']],
  ['touch', ['.']],
  ['touch', [A300]],
  ['touch', [A5000]],
  ['touch', [A5000, 'short']],
  ['touch', [`$D/${A5000}`]],
  ['touch', [`${'./'.repeat(3000)}normalized`]],
  ['touch', [`$D/${'./'.repeat(3000)}abs-normalized`]],
  ['touch', ['../up'], 'dir'],
  ['touch', ['../old', 'sub'], 'dir'],
  ['touch', ['sp ace', 'new\nline', 'ünïcödé']],
];

const MODES = ['buf', 'stdout', 'stderr', 'both'];

function setupFixture(dir) {
  fs.mkdirSync(path.join(dir, 'dir/sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'file'), 'content');
  fs.writeFileSync(path.join(dir, 'old'), 'old');
  fs.mkdirSync(path.join(dir, 'ro'));
  fs.mkdirSync(path.join(dir, 'noexec'));
  fs.writeFileSync(path.join(dir, 'noexec/inside'), '');
  fs.symlinkSync('dir', path.join(dir, 'linkdir'));
  fs.symlinkSync('file', path.join(dir, 'linkfile'));
  fs.symlinkSync('nowhere', path.join(dir, 'dangling'));
  for (const rel of [
    'dir/sub',
    'dir',
    'file',
    'old',
    'ro',
    'noexec/inside',
    'noexec',
    '.',
  ]) {
    fs.utimesSync(path.join(dir, rel), OLD_SECS, OLD_SECS);
  }
  for (const rel of ['linkdir', 'linkfile', 'dangling']) {
    fs.lutimesSync(path.join(dir, rel), OLD_SECS, OLD_SECS);
  }
  fs.chmodSync(path.join(dir, 'ro'), 0o555);
  fs.chmodSync(path.join(dir, 'noexec'), 0o666);
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

function timeClass(ms, win) {
  if (ms === OLD_SECS * 1000) {
    return 'old';
  }
  if (ms >= win.start - 50 && ms <= win.end + 50) {
    return 'new';
  }
  return `other:${ms}`;
}

/** Snapshot of the fixture tree (does not modify atimes of files). */
function snapshot(dir, win) {
  const out = {};
  const walk = (rel) => {
    const p = rel === '.' ? dir : path.join(dir, rel);
    let st;
    try {
      st = fs.lstatSync(p, { bigint: true });
    } catch (e) {
      out[rel] = `lstat:${e.code}`;
      return;
    }
    const mtimeMs = Number(st.mtimeNs / 1000000n);
    const e = {
      type: st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file',
      mode: (Number(st.mode) & 0o7777).toString(8),
      mtime: timeClass(mtimeMs, win),
    };
    if (e.type === 'file') {
      e.size = Number(st.size);
      e.atime = timeClass(Number(st.atimeNs / 1000000n), win);
      if (e.mtime === 'new' && e.atime === 'new') {
        e.sameTimes = st.atimeNs === st.mtimeNs;
      }
    }
    if (e.type === 'link') {
      e.target = fs.readlinkSync(p);
    }
    out[rel] = e;
    if (e.type === 'dir') {
      let names;
      try {
        names = fs.readdirSync(p).sort();
      } catch (err) {
        e.readdir = err.code;
        return;
      }
      for (const n of names) {
        walk(rel === '.' ? n : path.join(rel, n));
      }
    }
  };
  walk('.');
  return out;
}

function subst(args, dir) {
  return args.map((a) => a.replaceAll('$D', dir));
}

function norm(s, dir) {
  return s.replaceAll(dir, '$D');
}

// Output modes: both buffered; stdout / stderr / both (&>) redirected to a
// file (an fd Writer in the port). Bun 1.4.2 cannot parse two redirects on
// one command, so stdout and stderr are redirected in separate modes.
async function runPort(kind, args, dir, cwdRel, mode, ioDir) {
  const cwd = cwdRel ? path.join(dir, cwdRel) : dir;
  const shell = new ShellExecEnv({
    cwd,
    exportEnv: envMapFromObject(process.env),
  });
  const io = { stdout: { kind: 'buf', target: 'stdout' } };
  io.stderr = { kind: 'buf', target: 'stderr' };
  let fd = null;
  if (mode !== 'buf') {
    fd = fs.openSync(path.join(ioDir, 'out'), 'w');
    const w = new Writer(new FdTarget(fd));
    for (const which of mode === 'both' ? ['stdout', 'stderr'] : [mode]) {
      io[which] = { kind: 'fd', writer: w, captured: null };
    }
  }
  const b = new Builtin({
    kind,
    args: subst(args, dir),
    shell,
    stdin: { kind: 'ignore' },
    ...io,
  });
  const code = await (kind === 'mkdir' ? mkdir : touch)(b);
  await io.stdout.writer?.tail;
  await io.stderr.writer?.tail;
  if (fd !== null) {
    fs.closeSync(fd);
  }
  return collect(
    code,
    shell.bufferedStdout.toString(),
    shell.bufferedStderr.toString(),
    ioDir,
    dir
  );
}

async function runBun(kind, args, dir, cwdRel, mode, ioDir) {
  const cwd = cwdRel ? path.join(dir, cwdRel) : dir;
  const a = subst(args, dir);
  const out = path.join(ioDir, 'out');
  let p;
  if (mode === 'buf') {
    p = Bun.$`${kind} ${a}`;
  } else if (mode === 'stdout') {
    p = Bun.$`${kind} ${a} > ${out}`;
  } else if (mode === 'stderr') {
    p = Bun.$`${kind} ${a} 2> ${out}`;
  } else {
    p = Bun.$`${kind} ${a} &> ${out}`;
  }
  const r = await p.cwd(cwd).nothrow().quiet();
  return collect(
    r.exitCode,
    r.stdout.toString(),
    r.stderr.toString(),
    ioDir,
    dir
  );
}

function collect(code, stdout, stderr, ioDir, dir) {
  let file = null;
  try {
    file = norm(fs.readFileSync(path.join(ioDir, 'out'), 'utf8'), dir);
  } catch {
    // Not redirected.
  }
  return {
    code,
    stdout: norm(stdout, dir),
    stderr: norm(stderr, dir),
    file,
  };
}

async function runSide(runner, root, tag) {
  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    const [kind, args, cwdRel] = CASES[i];
    for (const mode of MODES) {
      const base = path.join(root, `${tag}-${i}-${mode}`);
      const dir = path.join(base, 'fx');
      const ioDir = path.join(base, 'io');
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(ioDir);
      setupFixture(dir);
      const win = { start: Date.now() };
      const res = await runner(kind, args, dir, cwdRel, mode, ioDir);
      win.end = Date.now();
      res.fs = snapshot(dir, win);
      unlockTree(base);
      fs.rmSync(base, { recursive: true, force: true });
      results.push(res);
    }
  }
  return { results };
}

const self = fileURLToPath(import.meta.url);

// The conformance corpus cases for mkdir/touch (templates are
// ["<cmd> [flags] ", ""] with one string or array value), run with the port.
async function runConformance() {
  const corpus = path.join(self, '../../../conformance/bun-shell/corpus.mjs');
  const { loadCorpus, materialize, checkExpectations, skipReason } =
    await import(corpus);
  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const { file, units } of loadCorpus()) {
    if (!/commands-(mkdir|touch)\.json$/.test(file)) {
      continue;
    }
    for (const unit of units) {
      for (const c of unit.cases || []) {
        if (skipReason(c)) {
          skip++;
          continue;
        }
        const tempDir = fs.realpathSync(
          fs.mkdtempSync(path.join(os.tmpdir(), 'mt-conf-'))
        );
        const { strings, values, cwd } = materialize(c, { tempDir });
        const [kind, ...flags] = strings[0].trim().split(/\s+/);
        const shell = new ShellExecEnv({
          cwd,
          exportEnv: envMapFromObject(process.env),
        });
        const b = new Builtin({
          kind,
          args: [...flags, ...values.flat()],
          shell,
          stdin: { kind: 'ignore' },
          stdout: { kind: 'buf', target: 'stdout' },
          stderr: { kind: 'buf', target: 'stderr' },
        });
        const exitCode = await (kind === 'mkdir' ? mkdir : touch)(b);
        const errs = checkExpectations(c, {
          exitCode,
          stdout: shell.bufferedStdout.toString(),
          stderr: shell.bufferedStderr.toString(),
          tempDir,
          sep: path.sep,
        });
        fs.rmSync(tempDir, { recursive: true, force: true });
        if (errs.length === 0) {
          pass++;
        } else {
          fail++;
          console.log(
            `CONFORMANCE FAIL ${c.id}: ${errs.join('; ').slice(0, 400)}`
          );
        }
      }
    }
  }
  console.log(`conformance: ${pass} pass, ${fail} fail, ${skip} skipped`);
}

if (process.argv[2] === 'conformance') {
  await runConformance();
} else if (process.argv[2] === 'port') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-diff-node-'));
  const r = await runSide(runPort, root, 'node');
  fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(process.argv[3], JSON.stringify(r));
} else {
  if (typeof Bun === 'undefined') {
    throw new Error('run under bun');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-diff-'));
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
  // Bun runs mkdir/touch operands concurrently, so multi-operand output lines
  // come in completion order; fall back to comparing sorted lines.
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
  for (let i = 0; i < CASES.length; i++) {
    for (let m = 0; m < MODES.length; m++) {
      const k = i * MODES.length + m;
      const want = JSON.stringify(bun.results[k]);
      for (const [label, side] of [
        ['port(bun)', portBun],
        ['port(node)', portNode],
      ]) {
        n++;
        const got = JSON.stringify(side.results[k]);
        if (
          got !== want &&
          unordered(side.results[k]) === unordered(bun.results[k])
        ) {
          orderOnly++;
        } else if (got !== want) {
          diffs++;
          const [kind, args, cwdRel] = CASES[i];
          const short = (s) => (s.length > 600 ? `${s.slice(0, 600)}...` : s);
          console.log(
            `DIFF ${label} ${kind} ${short(JSON.stringify(args))} cwd=${cwdRel ?? '.'} mode=${MODES[m]}`
          );
          console.log(`  bun:  ${short(want)}`);
          console.log(`  port: ${short(got)}`);
        }
      }
    }
  }
  console.log(
    `${n} comparisons (${CASES.length} cases x ${MODES.length} output modes x 2 runtimes), ${diffs} differences, ${orderOnly} line-order-only (Bun concurrency)`
  );
}
