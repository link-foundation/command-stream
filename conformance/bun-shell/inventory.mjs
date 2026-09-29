// Completeness check: re-scan the upstream Bun shell tests for unit sites and
// verify that the corpus has exactly one unit per site (and no stale units).
//
//   node conformance/bun-shell/inventory.mjs --bun-root /path/to/bun [--list]
//
// A "site" is a line matching a test registration (`test(`, `it(`,
// `test.skipIf(...)(`, `it.each(...)(`, `test.todo(` ...) or a TestBuilder
// `.runAsTest(` call. Regex false positives (commented-out tests, runAsTest
// calls nested inside a test(...) body, ...) must be listed in the corpus
// file's "nonUnitSites" with a reason.

import fs from 'node:fs';
import path from 'node:path';
import { loadCorpus } from './corpus.mjs';

export const SHELL_TEST_DIR = 'test/js/bun/shell';
const TEST_RE = /(?<![\w$.])(?:test|it)(?:\.[A-Za-z_$][\w$]*)*\s*\(/g;
const RUN_AS_TEST_RE = /\.runAsTest\(/g;

/** Corpus file name for an upstream path, e.g. commands/echo.test.ts -> commands-echo.json */
export function corpusNameFor(relSource) {
  return `${relSource
    .replace(`${SHELL_TEST_DIR}/`, '')
    .replace(/\.test\.ts$/, '')
    .replaceAll('/', '-')}.json`;
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walk(full));
    } else if (ent.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Scan upstream: returns [{source, sites: Map(line -> count)}]. */
export function scanUpstream(bunRoot) {
  const root = path.join(bunRoot, SHELL_TEST_DIR);
  return walk(root)
    .sort()
    .map((full) => {
      const source = path.relative(bunRoot, full).replaceAll('\\', '/');
      const sites = new Map();
      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const n =
            (line.match(TEST_RE) || []).length +
            (line.match(RUN_AS_TEST_RE) || []).length;
          if (n) {
            sites.set(i + 1, n);
          }
        });
      return { source, sites };
    });
}

export function checkInventory(bunRoot, { only, range } = {}) {
  const problems = [];
  // Files named X.partN.json are merged into X.json (used while authoring).
  const corpus = new Map();
  for (const c of loadCorpus()) {
    const name = c.file.replace(/\.part\d+\.json$/, '.json');
    const prev = corpus.get(name);
    if (prev) {
      prev.units.push(...c.units);
      prev.nonUnitSites.push(...c.nonUnitSites);
    } else {
      corpus.set(name, {
        ...c,
        units: [...c.units],
        nonUnitSites: [...c.nonUnitSites],
      });
    }
  }
  const stats = [];
  for (const scanned of scanUpstream(bunRoot)) {
    const { source } = scanned;
    let { sites } = scanned;
    if (only && !source.includes(only)) {
      corpus.delete(corpusNameFor(source));
      continue;
    }
    if (range) {
      sites = new Map(
        [...sites].filter(([l]) => l >= range[0] && l <= range[1])
      );
    }
    const name = corpusNameFor(source);
    const entry = corpus.get(name);
    corpus.delete(name);
    if (!entry) {
      problems.push(
        `${source}: missing corpus file cases/${name} (${sites.size} site lines)`
      );
      continue;
    }
    if (entry.source !== source) {
      problems.push(
        `cases/${name}: source should be ${source}, got ${entry.source}`
      );
    }
    const got = new Map();
    for (const u of entry.units) {
      got.set(u.line, (got.get(u.line) || 0) + 1);
    }
    for (const s of entry.nonUnitSites) {
      got.set(s.line, (got.get(s.line) || 0) + 1);
    }
    for (const [line, n] of sites) {
      const g = got.get(line) || 0;
      if (g !== n) {
        problems.push(
          `${source}:${line}: ${n} site(s) but ${g} unit/nonUnitSite entr(y/ies)`
        );
      }
    }
    for (const [line] of got) {
      if (range && (line < range[0] || line > range[1])) {
        continue;
      }
      if (!sites.has(line)) {
        problems.push(
          `${source}:${line}: stale unit/nonUnitSite (no test site on that line)`
        );
      }
    }
    const st = {
      file: name,
      source,
      units: entry.units.length,
      case: 0,
      'js-api': 0,
      inapplicable: 0,
      cases: 0,
    };
    for (const u of entry.units) {
      st[u.disposition] = (st[u.disposition] || 0) + 1;
      st.cases += (u.cases || []).length;
      if (!['case', 'js-api', 'inapplicable'].includes(u.disposition)) {
        problems.push(`${source}:${u.line}: bad disposition ${u.disposition}`);
      }
      if (u.disposition === 'case' && !(u.cases || []).length) {
        problems.push(`${source}:${u.line}: disposition case without cases`);
      }
      if (u.disposition === 'js-api' && !u.api) {
        problems.push(`${source}:${u.line}: js-api unit without "api"`);
      }
      if (u.disposition === 'inapplicable' && !u.reason) {
        problems.push(
          `${source}:${u.line}: inapplicable unit without "reason"`
        );
      }
      if (!u.upstream) {
        problems.push(`${source}:${u.line}: missing "upstream"`);
      }
    }
    stats.push(st);
  }
  for (const [name] of corpus) {
    problems.push(`cases/${name}: no matching upstream test file`);
  }
  return { problems, stats };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const i = process.argv.indexOf('--bun-root');
  const bunRoot = i >= 0 ? process.argv[i + 1] : process.env.BUN_ROOT;
  if (!bunRoot) {
    console.error(
      'usage: node inventory.mjs --bun-root /path/to/bun [--table] [--only source-substring] [--range FROM-TO]'
    );
    process.exit(2);
  }
  const oi = process.argv.indexOf('--only');
  const ri = process.argv.indexOf('--range');
  const { problems, stats } = checkInventory(bunRoot, {
    only: oi >= 0 ? process.argv[oi + 1] : undefined,
    range: ri >= 0 ? process.argv[ri + 1].split('-').map(Number) : undefined,
  });
  if (process.argv.includes('--table')) {
    const tot = { units: 0, case: 0, 'js-api': 0, inapplicable: 0, cases: 0 };
    console.log(
      '| Upstream file | Units | case | js-api | inapplicable | Cases |'
    );
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const s of stats) {
      console.log(
        `| \`${s.source.replace(`${SHELL_TEST_DIR}/`, '')}\` | ${s.units} | ${s.case} | ${s['js-api']} | ${s.inapplicable} | ${s.cases} |`
      );
      for (const k of Object.keys(tot)) {
        tot[k] += s[k];
      }
    }
    console.log(
      `| **Total** | **${tot.units}** | **${tot.case}** | **${tot['js-api']}** | **${tot.inapplicable}** | **${tot.cases}** |`
    );
  }
  for (const p of problems) {
    console.log(`PROBLEM ${p}`);
  }
  console.log(
    problems.length
      ? `${problems.length} problem(s)`
      : 'inventory OK: every upstream unit site is covered exactly once'
  );
  process.exit(problems.length ? 1 : 0);
}
