import { test, expect } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const probe = fileURLToPath(
  new URL('../../experiments/issue-31/compare-streams.mjs', import.meta.url)
);
for (const runtime of ['node', process.execPath]) {
  test(`stream transformations agree with installed competitors in ${runtime}`, async () => {
    const { stdout } = await run(runtime, [probe]);
    const { results } = JSON.parse(stdout);
    expect(Object.keys(results)).toContain('execa');
    expect(Object.keys(results)).toContain('zx');
    expect(Object.keys(results)).toContain('shelljsAsync');
    for (const result of Object.values(results)) {
      expect(result).toEqual([4, 8]);
    }
  }, 10000);
}
