#!/usr/bin/env node
// Re-check the links lychee reported as transient failures, and fail the link
// check only on links that are still broken.
//
// lychee 0.24 never retries a response it rejected for its status code except
// 429: a 503 is reported after one request whatever --max-retries says
// (lycheeverse/lychee#2193, reproduced by experiments/issue-216/
// lychee-retry-503.py). GitHub answers an occasional 503 to an unauthenticated
// burst, and that alone turned the scheduled run of 2026-09-28 red (#216).
//
// So: 429, 5xx, timeouts and transport errors are fetched again with an
// exponential backoff; any other status (404, 410, ...) is final at once. A
// recovered link is still printed as a warning, so a flapping host stays
// visible. Anything this script cannot interpret fails the check.
//
// Usage: LYCHEE_EXIT_CODE=<lychee exit code> \
//   node .github/scripts/recheck-transient-links.mjs [lychee/out.md]
// Tuning: LINK_RECHECK_ATTEMPTS (default 4), LINK_RECHECK_WAIT_MS (default
// 5000, doubled after each attempt). Per-attempt tracing: CI_SCRIPTS_DEBUG=1.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { debug } from '../../js/scripts/debug-print.mjs';

// lychee exits 2 when it found broken links; every other non-zero code is a
// failure of lychee itself (bad configuration, unreadable input, ...).
const LINKS_FAILED = '2';

// `* [503] <https://example.com/> (at 17:1) | Rejected status code: 503 ...`
const ENTRY = /^\s*[*-]\s+\[([^\]]+)\]\s+<([^>\s]+)>/;

/**
 * Parse the failures out of a lychee markdown report.
 * @param {string} report
 * @returns {{ marker: string, url: string, transient: boolean }[]}
 */
export function parseReport(report) {
  const entries = new Map();
  for (const line of report.split('\n')) {
    const match = ENTRY.exec(line);
    if (!match) {
      continue;
    }
    const [, marker, url] = match;
    // The same URL is listed once per document that links to it.
    entries.set(url, { marker, url, transient: isTransient(marker) });
  }
  return [...entries.values()];
}

/** 429 and 5xx mean "try again later"; TIMEOUT and ERROR got no answer. */
function isTransient(marker) {
  if (marker === 'TIMEOUT' || marker === 'ERROR') {
    return true;
  }
  const status = Number(marker);
  return status === 429 || (status >= 500 && status <= 599);
}

/** One GET, as lychee would accept it: any 2xx after redirects. */
async function fetchStatus(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'lychee/0.24.2' },
      signal: AbortSignal.timeout(30000),
    });
    await response.body?.cancel();
    return String(response.status);
  } catch (error) {
    return error.name === 'TimeoutError' ? 'TIMEOUT' : 'ERROR';
  }
}

/**
 * Fetch a URL until it answers 2xx, a final status, or the attempts run out.
 * @returns {Promise<{ ok: boolean, attempts: number, last: string }>}
 */
export async function recheck(
  url,
  { attempts, waitMs, fetchFn = fetchStatus }
) {
  let wait = waitMs;
  let last = '';
  let attempt = 0;
  while (attempt < attempts) {
    await new Promise((done) => setTimeout(done, wait));
    wait *= 2;
    attempt++;
    last = await fetchFn(url);
    debug('link re-check', { url, attempt, status: last });
    if (/^2\d\d$/.test(last)) {
      return { ok: true, attempts: attempt, last };
    }
    if (!isTransient(last)) {
      break;
    }
  }
  return { ok: false, attempts: attempt, last };
}

async function main() {
  const exitCode = process.env.LYCHEE_EXIT_CODE ?? '';
  if (exitCode === '0') {
    console.log('lychee found no broken links; nothing to re-check.');
    return 0;
  }
  if (exitCode !== LINKS_FAILED) {
    console.log(
      `::error::lychee exited with '${exitCode}', which is not a link failure; see the lychee step.`
    );
    return 1;
  }
  const reportPath = process.argv[2] ?? 'lychee/out.md';
  const entries = parseReport(readFileSync(reportPath, 'utf8'));
  if (entries.length === 0) {
    console.log(
      `::error::lychee reported broken links but ${reportPath} lists none this script can read.`
    );
    return 1;
  }
  const options = {
    attempts: Number(process.env.LINK_RECHECK_ATTEMPTS || 4),
    waitMs: Number(process.env.LINK_RECHECK_WAIT_MS || 5000),
  };
  let broken = 0;
  for (const { marker, url, transient } of entries) {
    if (!transient) {
      console.log(`::error::[${marker}] ${url}`);
      broken++;
      continue;
    }
    const result = await recheck(url, options);
    if (result.ok) {
      console.log(
        `::warning::[${marker}] ${url} answered ${result.last} on re-check ${result.attempts}; treated as transient.`
      );
    } else {
      console.log(
        `::error::[${marker}] ${url} still failing after re-checks (last: ${result.last}).`
      );
      broken++;
    }
  }
  console.log(
    `${entries.length - broken} of ${entries.length} reported links recovered; ${broken} broken.`
  );
  return broken === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
