// Tallies PASS/FAIL/SKIP per case file from a Rust corpus log.
// Run: node experiments/issue-27/corpus-per-file.mjs <log>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../../conformance/bun-shell/cases/', import.meta.url)
  .pathname;
const fileOf = new Map();
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const unit of data.units ?? []) {
    for (const c of unit.cases ?? []) {
      fileOf.set(c.id, f);
    }
  }
}
const tally = new Map();
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const m = /^(PASS|FAIL|SKIP)\s+(\S+)/.exec(line);
  if (!m) {
    continue;
  }
  const f = fileOf.get(m[2]) ?? `?${m[2]}`;
  const t = tally.get(f) ?? { PASS: 0, FAIL: 0, SKIP: 0 };
  t[m[1]]++;
  tally.set(f, t);
}
for (const [f, t] of [...tally].sort()) {
  console.log(`${f}: ${t.PASS} passed, ${t.FAIL} failed, ${t.SKIP} skipped`);
}
