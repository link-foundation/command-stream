import { expect, test } from 'bun:test';
import { runChecked } from '../scripts/run-checked.mjs';

test('issue #209: nonthrowing failed release commands cannot produce success', async () => {
  await expect(
    runChecked({ run: async () => ({ code: 1, stderr: 'rebase conflict' }) })
  ).rejects.toThrow('rebase conflict');
});

test('successful commands retain captured output', async () => {
  const result = { code: 0, stdout: '1.4.1' };
  expect(await runChecked({ run: async () => result })).toBe(result);
});
