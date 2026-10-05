// `$.zx`: the zx compatibility mode of the main `command-stream` `$`
// (issue #26). It is the same `$` that `command-stream/zx` exports, loaded on
// first access.

import assert from 'node:assert';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { $ } from '../../src/$.mjs';
import {
  $ as zx$,
  ProcessOutput,
  ProcessPromise,
} from '../../src/zx/index.mjs';

const require = createRequire(import.meta.url);

describe('$.zx', () => {
  test('is the $ of command-stream/zx', () => {
    assert.equal($.zx, zx$);
    assert.equal(require('../../src/$.cjs').zx, zx$);
  });

  test('runs commands with zx semantics', async () => {
    const p = $.zx`echo ${'two words'}`;
    assert.ok(p instanceof ProcessPromise);
    const output = await p;
    assert.ok(output instanceof ProcessOutput);
    assert.equal(output.stdout, 'two words\n');
    assert.equal(output.valueOf(), 'two words');
  });

  test('accepts zx options', async () => {
    const output = await $.zx({ nothrow: true, quiet: true })`exit 3`;
    assert.equal(output.exitCode, 3);
    assert.equal(output.ok, false);
    await assert.rejects($.zx({ quiet: true })`exit 4`, (error) => {
      assert.ok(error instanceof ProcessOutput);
      assert.equal(error.exitCode, 4);
      return true;
    });
  });

  test('is not an enumerable member of $', () => {
    assert.ok(!Object.keys($).includes('zx'));
  });
});
