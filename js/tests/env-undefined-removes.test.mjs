// Issue #229 (JS side): `env` replaces the child's environment, so a variable
// is removed by leaving it out or by giving it the value `undefined`, as in
// `{ ...process.env, NAME: undefined }`. Every execution path must agree.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { $, captureTerminal } from '../src/$.mjs';
import { isWindows } from './test-helper.mjs';

const NAME = 'COMMAND_STREAM_ENV_UNDEFINED_PROBE';
const probe = `node -e "process.stdout.write(process.env.${NAME} ?? 'unset')"`;
let previous;

beforeAll(() => {
  previous = process.env[NAME];
  process.env[NAME] = 'inherited';
});

afterAll(() => {
  if (previous === undefined) {
    delete process.env[NAME];
  } else {
    process.env[NAME] = previous;
  }
});

const withoutProbe = () => ({ ...process.env, [NAME]: undefined });

describe('env: undefined removes an inherited variable', () => {
  test('a copied environment keeps the variable', async () => {
    // Bun.spawn without `env` does not see variables set on process.env at
    // runtime, so the baseline passes the copy explicitly.
    const result = await $({ env: { ...process.env }, mirror: false })`${{
      raw: probe,
    }}`;
    expect(String(result.stdout)).toBe('inherited');
  });

  test('async shell commands', async () => {
    const result = await $({ env: withoutProbe(), mirror: false })`${{
      raw: probe,
    }}`;
    expect(String(result.stdout)).toBe('unset');
  });

  test('sync shell commands', () => {
    const result = $({ env: withoutProbe(), mirror: false })`${{
      raw: probe,
    }}`.sync();
    expect(String(result.stdout)).toBe('unset');
  });

  test('the virtual env command', async () => {
    const result = await $({ env: withoutProbe(), mirror: false })`env`;
    expect(String(result.stdout)).not.toContain(NAME);
    expect(String(result.stdout)).not.toContain('=undefined');
  });

  test.skipIf(isWindows)(
    'captureTerminal',
    async () => {
      const capture = await captureTerminal({
        file: process.execPath,
        args: [
          '-e',
          `console.log('probe=' + (process.env.${NAME} ?? 'unset'))`,
        ],
        env: withoutProbe(),
        cols: 40,
        rows: 3,
      });
      expect(capture.transcript).toContain('probe=unset');
    },
    30_000
  );
});
