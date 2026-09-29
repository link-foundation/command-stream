// Reference runner: validates the corpus against the real Bun.$ (the oracle).
//
//   bun conformance/bun-shell/run-bun-reference.mjs [--filter substr] [--file name]
//       [--concurrency N] [--node /path/to/node] [--verbose]
//
// Every case is executed in a fresh temp directory with Bun.$, using nothrow
// semantics unless the case sets "throws": true. Results are compared with
// checkExpectations() and a PASS/FAIL/SKIP line is printed per case.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  allCases,
  checkExpectations,
  materialize,
  materializeTemplate,
  makeContext,
  setupFiles,
  skipReason,
} from './corpus.mjs';

if (!globalThis.Bun) {
  console.error('run-bun-reference.mjs must be executed with bun');
  process.exit(2);
}
const { $ } = await import('bun');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const filter = opt('--filter');
const fileFilter = opt('--file');
const concurrency = Number(opt('--concurrency', '8'));
const verbose = args.includes('--verbose');
const node = opt('--node', Bun.which('node') || process.execPath);
const DEFAULT_TIMEOUT = 10_000;

let cases = allCases();
if (fileFilter) {
  cases = cases.filter(
    (c) => c.file.replace(/\.json$/, '') === fileFilter.replace(/\.json$/, '')
  );
}
if (filter) {
  cases = cases.filter((c) => c.id.includes(filter));
}

// Sanity: ids must be unique across the corpus.
{
  const seen = new Set();
  for (const c of allCases()) {
    if (seen.has(c.id)) {
      console.error(`duplicate case id: ${c.id}`);
      process.exit(2);
    }
    seen.add(c.id);
  }
}

const baseTmp = fs.realpathSync(os.tmpdir());

async function runOne(c) {
  const skip = skipReason(c, {
    platform: process.platform,
    language: 'js',
    which: (b) => !!Bun.which(b),
  });
  if (skip) {
    return { status: 'SKIP', details: [skip] };
  }

  const tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(baseTmp, 'bunshell-conf-'))
  );
  const ctx = makeContext({ tempDir, node, sep: path.sep });
  const result = { tempDir, node, sep: path.sep };
  try {
    setupFiles(c, tempDir, ctx);
    const m = materialize(c, { tempDir, node, sep: path.sep });
    const env = { ...(c.envReplace ? {} : process.env), ...m.env };
    const build = (strings, values, nothrow) => {
      let p = $(strings, ...values)
        .cwd(m.cwd)
        .env(env)
        .quiet();
      if (nothrow) {
        p = p.nothrow();
      }
      return p;
    };
    for (const step of c.setup || []) {
      const s = materializeTemplate(step, ctx);
      await build(s.strings, s.values, true);
    }
    result.buffers = m.buffers;
    const exec = async () => {
      try {
        const out = await build(m.strings, m.values, !c.throws);
        result.stdout = out.stdout;
        result.stderr = out.stderr;
        result.exitCode = out.exitCode;
      } catch (e) {
        result.error = e ?? new Error(String(e));
        if (e && typeof e === 'object') {
          result.stdout = e.stdout;
          result.stderr = e.stderr;
          result.exitCode = e.exitCode;
        }
      }
    };
    let timer;
    const timedOut = await Promise.race([
      exec().then(() => false),
      new Promise(
        (r) =>
          (timer = setTimeout(() => r(true), c.timeoutMs ?? DEFAULT_TIMEOUT))
      ),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      return {
        status: 'FAIL',
        details: [`timed out after ${c.timeoutMs ?? DEFAULT_TIMEOUT}ms`],
      };
    }
    const errs = checkExpectations(c, result);
    return { status: errs.length ? 'FAIL' : 'PASS', details: errs };
  } catch (e) {
    return { status: 'FAIL', details: [`runner error: ${e?.stack || e}`] };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort: a case may leave an unremovable file behind.
    }
  }
}

const started = Date.now();
const results = new Array(cases.length);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const i = next++;
    const t0 = Date.now();
    let r = await runOne(cases[i]);
    // Cases marked oracleFlaky hit a known intermittent Bun 1.4.2 bug; the
    // oracle gets a few more attempts (implementations get none).
    for (let a = 0; r.status === 'FAIL' && cases[i].oracleFlaky && a < 3; a++) {
      r = await runOne(cases[i]);
    }
    results[i] = { ...r, ms: Date.now() - t0 };
  }
}
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const r = results[i];
  counts[r.status]++;
  if (r.status === 'PASS' && !verbose) {
    console.log(`PASS ${c.id}`);
    continue;
  }
  console.log(`${r.status} ${c.id}  (${c.source}:${c.unitLine}, ${r.ms}ms)`);
  for (const d of r.details) {
    console.log(`     - ${d}`);
  }
}
console.log('');
console.log(
  `Bun ${Bun.version} on ${process.platform}; node for {{NODE}}: ${node}`
);
console.log(
  `Total ${cases.length}: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped in ${((Date.now() - started) / 1000).toFixed(1)}s`
);
process.exit(counts.FAIL ? 1 : 0);
