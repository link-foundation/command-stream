import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('ESM compatibility runs without synchronous require(esm)', () => {
  const result = spawnSync(
    'node',
    [
      '--no-experimental-require-module',
      fileURLToPath(
        new URL('../../experiments/issue-221/esm-consumer.mjs', import.meta.url)
      ),
    ],
    { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
