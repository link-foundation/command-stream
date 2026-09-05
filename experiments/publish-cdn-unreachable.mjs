#!/usr/bin/env node
// Why js/tests/publish-to-npm.test.mjs probes unpkg as well as npm.
//
// publish-to-npm.mjs starts with a module-scope
// `await fetch('https://unpkg.com/use-m/use.js')`. That await sits outside
// main()'s try/catch, so when the CDN is unreachable the script dies during
// module initialisation: nothing is written to GITHUB_OUTPUT and not even the
// first log line is printed. The suite then failed with
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
// the script's DNS-resolvable dependency at a blackholed host through
// use-m's own resolution path -- here simply by running with no network route
// to unpkg, emulated with an unroutable HTTPS proxy.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Capped so an unroutable proxy stalls the run for a bounded time instead of
// hanging until the connect attempt gives up on its own.
const TIMEOUT_MS = 20000;

const SCRIPT = resolve(
  new URL('..', import.meta.url).pathname,
  'js/scripts/publish-to-npm.mjs'
);

/**
 * Run publish-to-npm.mjs once and report what the test harness would see.
 * @param {string} label
 * @param {Record<string, string>} extraEnv
 * @returns {void}
 */
function run(label, extraEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-cdn-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'command-stream',
        version: '0.9.5',
        scripts: { 'changeset:publish': 'node -e "process.exit(1)"' },
      },
      null,
      2
    )
  );
  const outputFile = join(dir, 'gh-output.txt');
  writeFileSync(outputFile, '');

  const res = spawnSync('bun', [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, GITHUB_OUTPUT: outputFile, ...extraEnv },
  });

  const output = readFileSync(outputFile, 'utf8');
  const started = (res.stdout || '').includes('Current version to publish:');
  // A null status means spawnSync hit its own timeout and killed the child: the
  // script was still blocked in the module-scope fetch, never reaching main().
  // A real outage fails faster, but lands in the same place -- no output at all.
  const status =
    res.status === null ? `null (killed after ${TIMEOUT_MS}ms)` : res.status;
  console.log(`${label}:`);
  console.log(`  exit status      ${status}`);
  console.log(`  reached main()   ${started}`);
  console.log(`  GITHUB_OUTPUT    ${JSON.stringify(output)}`);
  console.log(
    `  first stderr line ${JSON.stringify((res.stderr || '').split('\n')[0])}`
  );
}

// 203.0.113.0/24 is TEST-NET-3 (RFC 5737): guaranteed never routable, so the
// unpkg fetch fails the way a real outage makes it fail.
run('unpkg unreachable (what the opaque failure looked like)', {
  HTTPS_PROXY: 'http://203.0.113.1:9',
  HTTP_PROXY: 'http://203.0.113.1:9',
});

run('unpkg reachable (normal run)', {});
