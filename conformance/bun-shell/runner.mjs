// Shared corpus runner: executes every case with a Bun.$-compatible `$`
// (the real Bun.$ for the reference run, command-stream's port otherwise) and
// prints a PASS/FAIL/SKIP line per case.
//
// Options (from argv): [--filter substr] [--file name] [--concurrency N]
//   [--node /path/to/node] [--verbose] [--trace]
//
// Results are printed once every case has finished. `--trace` also prints
// `RUN <id>` to stderr as each case starts, which locates a case that crashes
// the runtime itself (with `--concurrency 1`, the last line is the culprit).

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

const DEFAULT_TIMEOUT = 10_000;

/**
 * @param {object} opts
 * @param {Function} opts.$ the shell tagged template function
 * @param {string} opts.label runtime description for the summary line
 * @param {(bin: string) => boolean} opts.which executable lookup (skips)
 * @param {string} opts.defaultNode node binary used for {{NODE}}
 * @param {object} [opts.factory] corpus value factory overrides
 * @param {boolean} [opts.retryFlaky] retry `oracleFlaky` cases (oracle only)
 * @param {string[]} [opts.argv] command line arguments
 * @returns {Promise<{PASS: number, FAIL: number, SKIP: number}>}
 */
export async function runCorpus({
  $,
  label,
  which,
  defaultNode,
  factory = {},
  retryFlaky = false,
  argv = process.argv.slice(2),
}) {
  const opt = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : def;
  };
  const filter = opt('--filter');
  const fileFilter = opt('--file');
  const concurrency = Number(opt('--concurrency', '8'));
  const verbose = argv.includes('--verbose');
  const trace = argv.includes('--trace');
  const node = opt('--node', defaultNode);

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
  const seen = new Set();
  for (const c of allCases()) {
    if (seen.has(c.id)) {
      throw new Error(`duplicate case id: ${c.id}`);
    }
    seen.add(c.id);
  }

  const baseTmp = fs.realpathSync(os.tmpdir());

  async function runOne(c) {
    const skip = skipReason(c, {
      platform: process.platform,
      language: 'js',
      which,
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
      const m = materialize(c, { tempDir, node, sep: path.sep, factory });
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
      const timeout = c.timeoutMs ?? DEFAULT_TIMEOUT;
      const timedOut = await Promise.race([
        exec().then(() => false),
        new Promise((r) => (timer = setTimeout(() => r(true), timeout))),
      ]);
      clearTimeout(timer);
      if (timedOut) {
        return { status: 'FAIL', details: [`timed out after ${timeout}ms`] };
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
      if (trace) {
        process.stderr.write(`RUN ${cases[i].id}\n`);
      }
      let r = await runOne(cases[i]);
      // Cases marked oracleFlaky hit a known intermittent Bun 1.4.2 bug; the
      // oracle gets a few more attempts (implementations get none).
      for (
        let a = 0;
        retryFlaky && r.status === 'FAIL' && cases[i].oracleFlaky && a < 3;
        a++
      ) {
        if (trace || verbose) {
          process.stderr.write(
            `RETRY ${cases[i].id} (${a + 1}/3): ${r.details.join('; ')}; ${cases[i].oracleFlaky}\n`
          );
        }
        r = await runOne(cases[i]);
      }
      results[i] = { ...r, ms: Date.now() - t0 };
      if (trace) {
        process.stderr.write(`DONE ${cases[i].id}: ${r.status}\n`);
      }
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
  console.log(`${label} on ${process.platform}; node for {{NODE}}: ${node}`);
  console.log(
    `Total ${cases.length}: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  return counts;
}
