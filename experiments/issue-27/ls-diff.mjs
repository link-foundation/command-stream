// Differential test of the JS `ls` builtin port against Bun's real `ls`.
//
// Run with Node: `node experiments/issue-27/ls-diff.mjs`. It builds a fixture
// tree in a temp dir, runs every probe through the JS port (buffered output
// and fd output), then re-runs itself under `bun --bun-side` to collect Bun's
// results. Bun lists operands/subdirectories in parallel thread-pool tasks, so
// its section order varies between runs: each probe runs RUNS times in Bun
// and the JS result must equal one of the observed Bun results ("exact").
// Otherwise, if every observed Bun result is the JS result with its per-task
// output chunks (stdout and stderr) concatenated in a different order, the
// probe is reported "reordered" (Bun's nondeterministic task order).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNS = Number(process.env.RUNS ?? 40);
const here = path.dirname(fileURLToPath(import.meta.url));
const jsSrc = path.resolve(here, '../../js/src/bun-shell');

const PROBES = [
  [],
  ['-a'],
  ['-A'],
  ['-R'],
  ['-Ra'],
  ['-RA'],
  ['-l'],
  ['-la'],
  ['-lA', 'd1'],
  ['-alR', 'd1'],
  ['-d'],
  ['-d', 'd1', 'a', 'nope'],
  ['-ld', 'd1', 'a'],
  ['-dR', 'd1'],
  ['a'],
  ['d1'],
  ['d1', 'd2'],
  ['a', 'd1', 'nope'],
  ['d2', 'a', 'b'],
  ['nope'],
  ['nope1', 'nope2'],
  [''],
  ['', 'a'],
  ['-z'],
  ['-az'],
  ['-za'],
  ['--foo'],
  ['-'],
  ['--', 'a'],
  ['-é'],
  ['-aé'],
  ['a', '-l'],
  ['-1rtS', 'd2'],
  ['-C', '-F', '-h', 'd2'],
  ['empty'],
  ['-a', 'empty'],
  ['hidden-only'],
  ['-a', 'hidden-only'],
  ['restricted'],
  ['-d', 'restricted'],
  ['-l', 'restricted'],
  ['restricted/x'],
  ['-R', 'outer'],
  ['-lR', 'outer'],
  ['noexec'],
  ['-l', 'noexec'],
  ['-la', 'noexec'],
  ['lnk-file'],
  ['lnk-dir'],
  ['-l', 'lnk-dir'],
  ['-d', 'lnk-dir'],
  ['-ld', 'lnk-file'],
  ['-R', 'links'],
  ['-l', 'links'],
  ['broken'],
  ['-l', 'broken'],
  ['loop'],
  ['-l', 'loop'],
  ['loop/x'],
  ['a/x'],
  ['-l', 'a/x'],
  ['-d', 'a/x'],
  ['a/x/y/z'],
  ['d1', 'a/x'],
  ['a', 'a/x'],
  ['fifo'],
  ['-l', 'fifo'],
  ['-l', 'modes'],
  ['-l', 'times'],
  ['.h'],
  ['-d', '.h'],
  ['./a'],
  ['-l', './a'],
  ['d1/'],
  ['-R', 'd1/'],
  ['-R', 'd1//'],
  ['-R', '.'],
  ['-R', './d1'],
  ['@ABS_D2'],
  ['-R', '@ABS_D1'],
  ['/dev/null'],
  ['-l', '/dev/null'],
  ['weird'],
  ['-l', 'weird'],
  ['spaces'],
  ['-R', 'tree'],
];

function buildFixture(root) {
  const mk = (p) => fs.mkdirSync(path.join(root, p), { recursive: true });
  const touch = (p, content = '') => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), content);
  };
  touch('a', 'hello');
  touch('b');
  touch('.h');
  touch('d1/x');
  touch('d1/.hx');
  touch('d1/sub/y');
  touch('d1/sub/deep/z');
  touch('d2/q');
  touch('d3/r');
  mk('empty');
  touch('hidden-only/.h1');
  touch('hidden-only/.h2');
  mk('restricted');
  touch('outer/f1');
  touch('outer/closed/f2');
  touch('outer/open/f3');
  touch('noexec/n1');
  touch('noexec/n2');
  fs.symlinkSync('a', path.join(root, 'lnk-file'));
  fs.symlinkSync('d1', path.join(root, 'lnk-dir'));
  fs.symlinkSync('missing', path.join(root, 'broken'));
  fs.symlinkSync('loop', path.join(root, 'loop'));
  touch('links/real');
  fs.symlinkSync('../d1', path.join(root, 'links/to-dir'));
  fs.symlinkSync('real', path.join(root, 'links/to-file'));
  fs.symlinkSync('gone', path.join(root, 'links/dangling'));
  fs.linkSync(path.join(root, 'links/real'), path.join(root, 'links/hard'));
  execFileSync('mkfifo', [path.join(root, 'fifo')]);
  touch('modes/suid', '#!/bin/sh\n');
  touch('modes/suid-noexec');
  touch('modes/sgid');
  touch('modes/sgid-noexec');
  mk('modes/sticky');
  mk('modes/sticky-noexec');
  touch('modes/none');
  touch('modes/all');
  touch('times/old');
  touch('times/future');
  touch('times/epoch');
  touch('times/negative');
  touch('times/recent-edge');
  mk('weird');
  fs.writeFileSync(
    Buffer.concat([
      Buffer.from(`${root}/weird/`),
      Buffer.from([0x66, 0xff, 0xfe, 0x67]),
    ]),
    ''
  );
  touch('weird/ünïcödé');
  touch('spaces/file with spaces');
  touch('spaces/tab\there');
  touch('spaces/new\nline');
  touch('spaces/colon:');
  for (let i = 0; i < 40; i++) {
    touch(`tree/n${i % 5}/m${i}/leaf${i}`);
  }
  const ch = (p, m) => fs.chmodSync(path.join(root, p), m);
  ch('modes/suid', 0o4755);
  ch('modes/suid-noexec', 0o4644);
  ch('modes/sgid', 0o2750);
  ch('modes/sgid-noexec', 0o2640);
  ch('modes/sticky', 0o1777);
  ch('modes/sticky-noexec', 0o1776);
  ch('modes/none', 0o000);
  ch('modes/all', 0o777);
  const ut = (p, secs) => fs.utimesSync(path.join(root, p), secs, secs);
  const now = Math.floor(Date.now() / 1000);
  ut('times/old', 978307200 + 3723); // 2001-01-01 01:02:03
  ut('times/future', 4102444800); // 2100
  ut('times/epoch', 0);
  ut('times/negative', -86400 * 400);
  ut('times/recent-edge', now - 179 * 86400);
  ch('restricted', 0o000);
  ch('outer/closed', 0o000);
  ch('noexec', 0o644);
}

function cleanup(root) {
  for (const p of ['restricted', 'outer/closed', 'noexec']) {
    try {
      fs.chmodSync(path.join(root, p), 0o755);
    } catch {
      // Ignore.
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

function resolveArgs(args, root) {
  return args.map((a) =>
    a.startsWith('@ABS_') ? path.join(root, a.slice(5).toLowerCase()) : a
  );
}

const hex = (buf) => Buffer.from(buf).toString('hex');

// Output modes: 'buf' (both captured), 'out' (`> f`), 'err' (`2> f`) and
// 'both' (`&> f`). Bun 1.4.2 rejects two redirects on one command
// ("expected a command or assignment but got: Redirect"), hence no `> f 2> g`.
const MODES = ['buf', 'out', 'err', 'both'];

// --- Bun side --------------------------------------------------------------

function bunCommand(args, mode, f) {
  switch (mode) {
    case 'out':
      return Bun.$`ls ${args} > ${f}`;
    case 'err':
      return Bun.$`ls ${args} 2> ${f}`;
    case 'both':
      return Bun.$`ls ${args} &> ${f}`;
    default:
      return Bun.$`ls ${args}`;
  }
}

async function bunSide(root, outFile) {
  const results = [];
  const f = path.join(os.tmpdir(), `ls-diff-bun-out-${process.pid}`);
  for (const probe of PROBES) {
    const args = resolveArgs(probe, root);
    const seen = {};
    for (const mode of MODES) {
      seen[mode] = new Set();
      for (let i = 0; i < RUNS; i++) {
        fs.rmSync(f, { force: true });
        const r = await bunCommand(args, mode, f).cwd(root).nothrow().quiet();
        const file = mode === 'buf' ? '' : hex(fs.readFileSync(f));
        const out = mode === 'out' || mode === 'both' ? file : hex(r.stdout);
        const err = mode === 'err' ? file : hex(r.stderr);
        seen[mode].add(JSON.stringify([r.exitCode, out, err]));
      }
      seen[mode] = [...seen[mode]];
    }
    results.push(seen);
  }
  fs.rmSync(f, { force: true });
  fs.writeFileSync(outFile, JSON.stringify(results));
}

// --- JS side ---------------------------------------------------------------

async function jsSide(root) {
  const { Builtin } = await import(path.join(jsSrc, 'builtin.mjs'));
  const { ls } = await import(path.join(jsSrc, 'builtins/ls.mjs'));
  const { ShellExecEnv, envMapFromObject } = await import(
    path.join(jsSrc, 'env.mjs')
  );
  const { Writer, FdTarget } = await import(path.join(jsSrc, 'io.mjs'));
  const f = path.join(os.tmpdir(), `ls-diff-js-out-${process.pid}`);
  const results = [];
  for (const probe of PROBES) {
    const args = resolveArgs(probe, root);
    const seen = {};
    for (const mode of MODES) {
      const shell = new ShellExecEnv({
        cwd: root,
        exportEnv: envMapFromObject(process.env),
      });
      const fd = mode === 'buf' ? null : fs.openSync(f, 'w');
      const writer = fd === null ? null : new Writer(new FdTarget(fd));
      const fdOut = { kind: 'fd', writer, captured: null };
      const stdoutBuf = { kind: 'buf', target: 'stdout' };
      const stderrBuf = { kind: 'buf', target: 'stderr' };
      const b = new Builtin({
        kind: 'ls',
        args,
        shell,
        stdin: { kind: 'ignore' },
        stdout: mode === 'out' || mode === 'both' ? fdOut : stdoutBuf,
        stderr: mode === 'err' || mode === 'both' ? fdOut : stderrBuf,
      });
      const code = await ls(b);
      if (mode === 'buf') {
        const chunks = (list) => list.chunks.map(hex);
        seen.chunks = {
          out: chunks(shell.bufferedStdout),
          err: chunks(shell.bufferedStderr),
        };
      }
      let file = '';
      if (fd !== null) {
        fs.closeSync(fd);
        file = hex(fs.readFileSync(f));
      }
      const out =
        mode === 'out' || mode === 'both'
          ? file
          : hex(shell.bufferedStdout.toBuffer());
      const err = mode === 'err' ? file : hex(shell.bufferedStderr.toBuffer());
      seen[mode] = JSON.stringify([code, out, err]);
    }
    results.push(seen);
  }
  fs.rmSync(f, { force: true });
  return results;
}

/** Whether `whole` (hex) is a concatenation of all `chunks` in some order. */
function isPermutation(whole, chunks) {
  const used = chunks.map(() => false);
  const go = (pos) => {
    if (pos === whole.length) {
      return used.every(Boolean);
    }
    for (let i = 0; i < chunks.length; i++) {
      if (!used[i] && whole.startsWith(chunks[i], pos)) {
        used[i] = true;
        if (go(pos + chunks[i].length)) {
          return true;
        }
        used[i] = false;
      }
    }
    return false;
  };
  return go(0);
}

function isReordered(mine, theirs, chunks, mode) {
  const [code] = JSON.parse(mine);
  const outChunks =
    mode === 'both' ? [...chunks.err, ...chunks.out] : chunks.out;
  const errChunks = mode === 'both' ? [] : chunks.err;
  return theirs.every((t) => {
    const [tcode, tout, terr] = JSON.parse(t);
    return (
      tcode === code &&
      isPermutation(tout, outChunks) &&
      isPermutation(terr, errChunks)
    );
  });
}

function decode(key) {
  const [code, out, err] = JSON.parse(key);
  return JSON.stringify([
    code,
    Buffer.from(out, 'hex').toString(),
    Buffer.from(err, 'hex').toString(),
  ]);
}

async function main() {
  if (process.argv[2] === '--bun-side') {
    await bunSide(process.argv[3], process.argv[4]);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-diff-'));
  const bunOut = path.join(os.tmpdir(), `ls-diff-bun-${process.pid}.json`);
  try {
    buildFixture(root);
    const js = await jsSide(root);
    const r = spawnSync(
      'bun',
      [fileURLToPath(import.meta.url), '--bun-side', root, bunOut],
      { stdio: 'inherit', env: { ...process.env, RUNS: String(RUNS) } }
    );
    if (r.status !== 0) {
      throw new Error('bun side failed');
    }
    const bun = JSON.parse(fs.readFileSync(bunOut, 'utf8'));
    let exact = 0;
    let reordered = 0;
    let diff = 0;
    PROBES.forEach((probe, i) => {
      for (const kind of MODES) {
        const mine = js[i][kind];
        const theirs = bun[i][kind];
        let status;
        if (theirs.includes(mine)) {
          status = 'exact';
          exact++;
        } else if (isReordered(mine, theirs, js[i].chunks, kind)) {
          status = 'reordered';
          reordered++;
        } else {
          status = 'DIFF';
          diff++;
        }
        if (status === 'reordered') {
          console.log(`reordered ${kind} ls ${JSON.stringify(probe)}`);
        } else if (status !== 'exact' || process.env.VERBOSE) {
          console.log(`${status} ${kind} ls ${JSON.stringify(probe)}`);
          console.log(`  js:  ${decode(mine)}`);
          for (const t of theirs.slice(0, 3)) {
            console.log(`  bun: ${decode(t)}`);
          }
        }
      }
    });
    console.log(
      `${PROBES.length} probes x ${MODES.length} output modes: ${exact} exact, ` +
        `${reordered} reordered, ${diff} different (Bun runs/probe: ${RUNS})`
    );
    process.exitCode = diff > 0 ? 1 : 0;
  } finally {
    cleanup(root);
    fs.rmSync(bunOut, { force: true });
  }
}

await main();
