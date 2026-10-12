// Regression tests for the jscpd duplication check (issue #199).
//
// `bun run check:duplication` was a no-op that always passed. jscpd's `format`
// option is the list of *languages* to analyse, but .jscpd.json set it to the
// string "console" — a reporter name. The finder filters files with
//
//   options.format.includes(format)                  // @jscpd/finder
//
// and `"console".includes("javascript")` is false, so every file was skipped:
// zero sources, zero clones, exit 0, in under a millisecond. The check reported
// success without ever looking at the code (a false negative).
//
// These tests run the real binary against a fixture that contains one obvious
// clone, so they fail if the configuration ever stops analysing JavaScript.

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const jscpdBin = join(jsDir, 'node_modules', '.bin', 'jscpd');
const repoConfig = JSON.parse(readFileSync(join(jsDir, '.jscpd.json'), 'utf8'));

// Two files sharing an identical block, comfortably above minTokens/minLines.
const DUPLICATED_BLOCK = [
  'export function normalize(input) {',
  "  const trimmed = String(input ?? '').trim();",
  '  if (trimmed.length === 0) {',
  "    return { ok: false, reason: 'empty' };",
  '  }',
  "  const parts = trimmed.split(',').map((part) => part.trim());",
  '  const unique = Array.from(new Set(parts));',
  "  return { ok: true, value: unique.join('|') };",
  '}',
].join('\n');

let workDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'jscpd-check-'));
  mkdirSync(join(workDir, 'src'));
  writeFileSync(join(workDir, 'src', 'first.mjs'), `${DUPLICATED_BLOCK}\n`);
  writeFileSync(join(workDir, 'src', 'second.mjs'), `${DUPLICATED_BLOCK}\n`);
});

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

/**
 * Run jscpd over the fixture with the given `format` value and return the
 * statistics it produced. `threshold` is high so the run always exits 0 and the
 * assertions are about what jscpd *saw*, not about its verdict.
 */
function runJscpd(format, outputName) {
  const output = join(workDir, outputName);
  const configPath = join(workDir, `${outputName}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      minTokens: repoConfig.minTokens,
      minLines: repoConfig.minLines,
      threshold: 100,
      format,
      reporters: ['json'],
      output,
    })
  );

  const result = spawnSync(jscpdBin, ['-c', configPath, 'src'], {
    cwd: workDir,
    encoding: 'utf8',
  });
  // jscpd writes no report at all when it analysed nothing, which is itself
  // the symptom of the bug; report that as zero sources rather than crashing.
  const reportPath = join(output, 'jscpd-report.json');
  const total = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8')).statistics.total
    : { sources: 0, clones: 0 };
  return { exitCode: result.status, total };
}

test('the repository config analyses JavaScript, not a reporter name', () => {
  // The exact shape of the bug: a bare string here silently disables the check.
  expect(Array.isArray(repoConfig.format)).toBe(true);
  expect(repoConfig.format).toContain('javascript');
});

test('the repository config detects a real clone', () => {
  const { exitCode, total } = runJscpd(repoConfig.format, 'out-repo-config');
  expect(exitCode).toBe(0);
  expect(total.sources).toBe(2);
  expect(total.clones).toBeGreaterThan(0);
});

test('the old "console" format skipped every file', () => {
  // Documents the false negative so nobody reintroduces it as a "fix".
  const { total } = runJscpd('console', 'out-old-config');
  expect(total.sources).toBe(0);
  expect(total.clones).toBe(0);
});

test('the duplication script points at directories that exist', () => {
  const pkg = JSON.parse(readFileSync(join(jsDir, 'package.json'), 'utf8'));
  const script = pkg.scripts['check:duplication'];
  expect(script.startsWith('jscpd ')).toBe(true);

  // A path typo would make jscpd scan nothing and pass, exactly like the
  // format bug did, so the targets are checked against the working tree.
  const targets = script.split(/\s+/).slice(1);
  expect(targets).toContain('src');
  expect(targets).toContain('scripts');
  for (const target of targets) {
    expect(existsSync(join(jsDir, target))).toBe(true);
  }
});

test('the threshold is a real gate, not a way to switch the check off', () => {
  // The check had never run, so the tree already contained 5.55% duplicated
  // tokens when it was switched on: a threshold of 0 would have failed on
  // existing code instead of on a regression. 6 sits just above today's
  // measurement. Anything much higher passes whatever is added, which is the
  // same false negative in a different disguise.
  expect(typeof repoConfig.threshold).toBe('number');
  expect(repoConfig.threshold).toBeGreaterThan(0);
  expect(repoConfig.threshold).toBeLessThanOrEqual(10);
});
