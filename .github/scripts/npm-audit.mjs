#!/usr/bin/env node
// Audit the committed js/package-lock.json at high severity, skipping the
// advisories listed in .github/audit-ignore.txt.
//
// `npm audit` has no way to ignore a single advisory, and `bun audit --ignore`
// does, so this wrapper gives both lockfile audits the same ignore list. It
// fails on any high or critical advisory that is not listed, and warns about
// listed advisories that no longer match so stale entries get removed.
//
// Usage (from js/): node ../.github/scripts/npm-audit.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FAILING = new Set(['high', 'critical']);
const ignoreFile = new URL('../audit-ignore.txt', import.meta.url);

const ignored = new Set(
  readFileSync(ignoreFile, 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
);

let report;
try {
  report = execFileSync('npm', ['audit', '--package-lock-only', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still
  // on stdout. Anything else (no stdout) is a real failure.
  if (!error.stdout) {
    throw error;
  }
  report = error.stdout;
}

const parsed = JSON.parse(report);
// npm also emits JSON on transport/authentication failures. Those are not
// empty successful audits: accepting them would silently disable this gate.
if (parsed.error) {
  throw new Error(
    `npm audit failed: ${parsed.error.code}: ${parsed.error.summary}`
  );
}
if (
  !parsed.vulnerabilities ||
  typeof parsed.vulnerabilities !== 'object' ||
  Array.isArray(parsed.vulnerabilities)
) {
  throw new Error('npm audit returned an invalid vulnerability report');
}
const { vulnerabilities } = parsed;
const advisories = new Map();
for (const [pkg, entry] of Object.entries(vulnerabilities)) {
  for (const via of entry.via) {
    // String entries point at another vulnerable package; the advisory itself
    // is reported on that package.
    if (typeof via !== 'object' || !FAILING.has(via.severity)) {
      continue;
    }
    const id = via.url?.split('/').pop() ?? String(via.source);
    advisories.set(id, `${pkg}: ${via.title} (${via.severity}) ${via.url}`);
  }
}

const unhandled = [...advisories].filter(([id]) => !ignored.has(id));
for (const [id, description] of advisories) {
  if (ignored.has(id)) {
    console.log(`ignored ${id} ${description}`);
  }
}
for (const id of ignored) {
  if (!advisories.has(id)) {
    console.log(
      `::warning::${id} is listed in .github/audit-ignore.txt but no longer reported by npm audit; remove it`
    );
  }
}
for (const [id, description] of unhandled) {
  console.log(`::error::${id} ${description}`);
}
if (unhandled.length > 0) {
  process.exit(1);
}
console.log(
  `npm audit: no unignored high or critical advisories (${advisories.size} ignored)`
);
