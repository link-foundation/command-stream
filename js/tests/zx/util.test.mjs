// Port of zx test/util.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0); each test title carries the pinned upstream unit id.

import assert from 'node:assert';
import path from 'node:path';
import process from 'node:process';
import { describe, test } from 'node:test';
import {
  buildCmd,
  getLast,
  identity,
  isString,
  isStringLiteral,
  noop,
  once,
  parseBool,
  parseDuration,
  preferLocalBin,
  quote,
  quotePowerShell,
  randomId,
  toCamelCase,
} from '../../src/zx/util.mjs';

const ALLOWED =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/.-+@:=,%';

describe('zx util', () => {
  test('[zx:test/util.test.js:35:3:registration] randomId()', () => {
    assert.ok(/^[a-z0-9]+$/.test(randomId()));
    const ids = new Set(Array.from({ length: 1000 }).map(() => randomId()));
    assert.equal(ids.size, 1000);
  });

  test('[zx:test/util.test.js:42:3:registration] noop()', () => {
    assert.equal(noop(), undefined);
  });

  test('[zx:test/util.test.js:46:3:registration] once()', () => {
    const fn = once(identity);
    assert.equal(identity(1), 1);
    assert.equal(identity(2), 2);
    assert.equal(fn(1), 1);
    assert.equal(fn(2), 1);
  });

  test('[zx:test/util.test.js:54:3:registration] isString()', () => {
    assert.ok(isString('string'));
    assert.ok(!isString(1));
  });

  test('[zx:test/util.test.js:59:3:registration] isStringLiteral()', () => {
    const bar = 'baz';
    assert.ok(isStringLiteral``);
    assert.ok(isStringLiteral`foo`);
    assert.ok(isStringLiteral`foo ${bar}`);
    assert.ok(!isStringLiteral(''));
    assert.ok(!isStringLiteral('foo'));
    assert.ok(!isStringLiteral(['foo']));
  });

  test('[zx:test/util.test.js:70:3:registration] quote()', () => {
    assert.equal(quote('string'), 'string');
    assert.equal(quote(''), `$''`);
    assert.equal(quote(`'\f\n\r\t\v\0`), `$'\\'\\f\\n\\r\\t\\v\\0'`);
    assert.equal(quote(ALLOWED), ALLOWED);
  });

  test('[zx:test/util.test.js:80:3:registration] quotePowerShell()', () => {
    assert.equal(quotePowerShell('string'), 'string');
    assert.equal(quotePowerShell(`'`), `''''`);
    assert.equal(quotePowerShell(''), `''`);
    assert.equal(quotePowerShell(ALLOWED), ALLOWED);
  });

  test('[zx:test/util.test.js:90:3:registration] duration parsing works', () => {
    assert.equal(parseDuration(0), 0);
    assert.equal(parseDuration(1000), 1000);
    assert.equal(parseDuration('100'), 100);
    assert.equal(parseDuration('2s'), 2000);
    assert.equal(parseDuration('500ms'), 500);
    assert.equal(parseDuration('2m'), 120000);
    assert.throws(() => parseDuration('f2ms'));
    assert.throws(() => parseDuration('2mss'));
    assert.throws(() => parseDuration(NaN));
    assert.throws(() => parseDuration(-1));
  });

  // Upstream keeps this test commented out: multiline template pieces are
  // passed to the shell verbatim rather than being whitespace-normalized.
  test('[zx:test/util.test.js:103:3:registration] normalizeMultilinePieces()', async () => {
    const pieces = Object.assign([' a ', 'b    c    d', ' e'], {
      raw: [' a ', 'b    c    d', ' e'],
    });
    const cmd = await buildCmd(quote, pieces, ['x', 'y']);
    assert.equal(cmd, ' a xb    c    dy e');
  });

  test('[zx:test/util.test.js:110:3:registration] preferLocalBin()', () => {
    const cwd = process.cwd();
    const env = {
      PATH: ['/usr/bin', '/bin', '/usr/local/bin'].join(path.delimiter),
    };
    const pathKey = Object.keys(preferLocalBin(env, cwd)).find(
      (k) => k.toUpperCase() === 'PATH'
    );
    assert.equal(
      preferLocalBin(env, cwd)[pathKey],
      [path.join(cwd, 'node_modules', '.bin'), cwd, env.PATH].join(
        path.delimiter
      )
    );
  });

  test('[zx:test/util.test.js:121:3:registration] toCamelCase()', () => {
    assert.equal(toCamelCase('VERBOSE'), 'verbose');
    assert.equal(toCamelCase('PREFER_LOCAL'), 'preferLocal');
    assert.equal(toCamelCase('SOME_MORE_BIG_STR'), 'someMoreBigStr');
    assert.equal(toCamelCase('kebab-input-str'), 'kebabInputStr');
  });

  test('[zx:test/util.test.js:128:3:registration] parseBool()', () => {
    assert.equal(parseBool('true'), true);
    assert.equal(parseBool('false'), false);
    assert.equal(parseBool('other'), 'other');
  });

  test('[zx:test/util.test.js:134:3:registration] getLast()', () => {
    assert.equal(getLast([1, 2, 3]), 3);
    assert.equal(getLast([]), undefined);
  });
});
