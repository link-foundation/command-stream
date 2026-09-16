#!/usr/bin/env node
// Why js/tests/publish-to-npm.test.mjs probes unpkg as well as npm, and what
// js/scripts/use-m-loader.mjs changed about it.
//
// Every release script needs `use-m`, which is fetched from
// https://unpkg.com/use-m/use.js and eval-ed. Eleven scripts did that inline,
// at module scope:
//
//   const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
//
// That await sits outside main()'s try/catch, has no deadline and no retry, so
// an unreachable CDN killed the script during module initialisation: nothing
// was written to GITHUB_OUTPUT and not even the first log line was printed. The
// suite then failed with
//
//   Expected to contain: "published=true"
//   Received: ""
//
// which names neither the CDN nor the network. Observed intermittently while
// investigating issue #199: two runs of the same unchanged suite differed only
// in whether unpkg answered.
//
// The old offline guard probed `npm view` only. npm and unpkg fail
// independently, so a reachable registry said "we are online" while the
// dependency the script actually needs at startup was not.
//
// This script forces the failure without waiting for a real outage, by pointing
// the fetch at a blackholed address, and runs both shapes side by side: the
// legacy inline fetch and the shared loader the scripts use now.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// 203.0.113.0/24 is TEST-NET-3 (RFC 5737): guaranteed never routable. Standing
// in for unpkg, it fails the way a real outage makes the CDN fail -- a connect
// that never completes -- without depending on proxy settings a given runtime
// may or may not honour.
const BLACKHOLE_URL = 'https://203.0.113.1/use-m/use.js';

// Capped so an unroutable proxy stalls the run for a bounded time instead of
// hanging until the connect attempt gives up on its own.
const TIMEOUT_MS = 30000;

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const LOADER = join(repoRoot, 'js/scripts/use-m-loader.mjs');
const dir = mkdtempSync(join(tmpdir(), 'publish-cdn-'));

/**
 * Run one .mjs source in a scratch directory and report what a CI log would
 * show: whether the script reached its own code, and what it said when it did
 * not.
 * @param {string} label
 * @param {string} source
 * @returns {void}
 */
function run(label, source) {
  const script = join(dir, `${label.replace(/\W+/g, '-')}.mjs`);
  writeFileSync(script, source);
  const outputFile = join(dir, 'gh-output.txt');
  writeFileSync(outputFile, '');

  const started = Date.now();
  const res = spawnSync('node', [script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });

  // A null status means spawnSync hit its own timeout and killed the child: the
  // script was still blocked in a fetch with no deadline of its own.
  const status =
    res.status === null ? `null (killed after ${TIMEOUT_MS}ms)` : res.status;
  // Node prints the offending source line before the error itself; the message
  // a reader of the CI log actually sees is the first line naming an Error type.
  const message = (res.stderr || '')
    .split('\n')
    .find((line) => /^[A-Za-z]*Error(:| \[)/.test(line.trim()));
  console.log(`${label}:`);
  console.log(`  exit status       ${status}`);
  console.log(`  elapsed           ${Date.now() - started}ms`);
  console.log(`  stdout            ${JSON.stringify(res.stdout || '')}`);
  console.log(`  failure reported  ${JSON.stringify(message ?? '')}`);
  console.log('');
}

// Before: the module-scope fetch the eleven release scripts used to open with.
run(
  'legacy inline fetch',
  `const { use } = eval(
     await (await fetch(${JSON.stringify(BLACKHOLE_URL)})).text()
   );
   console.log('reached the script body');`
);

// After: the same failure through js/scripts/use-m-loader.mjs. attempts and
// timeoutMs are shortened here only so the experiment finishes quickly; the
// code path, the retry and the message are the production ones. Set
// CI_SCRIPTS_DEBUG=1 to see one ::debug:: line per attempt.
run(
  'shared loader',
  `import { loadUseM } from ${JSON.stringify(LOADER)};
   const use = await loadUseM({
     url: ${JSON.stringify(BLACKHOLE_URL)},
     attempts: 2,
     timeoutMs: 3000,
     retryDelayMs: 200,
   });
   console.log('reached the script body');`
);
