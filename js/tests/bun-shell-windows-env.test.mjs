// The libuv-required Windows variables the port adds to a child's env, so a
// Node.js child spawned from Deno (which does not add them) can start.

import { test, expect } from 'bun:test';
import { withRequiredWindowsEnv } from '../src/bun-shell/subprocess.mjs';

test('missing required variables come from the parent', () => {
  const parent = { SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', OTHER: 'x' };
  expect(withRequiredWindowsEnv({ FOO: 'bar' }, parent)).toEqual({
    FOO: 'bar',
    SYSTEMROOT: 'C:\\Windows',
    TEMP: 'C:\\t',
  });
});

test('variables the env already has are kept, case-insensitively', () => {
  const parent = { SYSTEMROOT: 'C:\\Windows' };
  expect(withRequiredWindowsEnv({ SystemRoot: 'D:\\W' }, parent)).toEqual({
    SystemRoot: 'D:\\W',
  });
});
