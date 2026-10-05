import { describe, test } from 'node:test';
import assert from 'node:assert';
import depseekModule, {
  depseekSync,
  depseek,
} from '../../src/zx/vendor/depseek.mjs';

const strip = (tokens) => tokens.map(({ type, value }) => ({ type, value }));

// Mirrors how zx's parseDeps() pairs a dependency with a trailing comment.
function versions(content) {
  const tokens = depseekSync(content, { comments: true });
  const result = {};
  tokens.forEach((token, i) => {
    if (token.type !== 'dep') {
      return;
    }
    const next = tokens[i + 1];
    const match =
      next && next.type === 'comment'
        ? /^@(\S+)/.exec(next.value.trim())
        : null;
    result[token.value] = match ? match[1] : 'latest';
  });
  return result;
}

describe('vendor/depseek', () => {
  test('exports the depseek API', () => {
    assert.strictEqual(depseek, depseekSync);
    assert.strictEqual(depseekModule.depseekSync, depseekSync);
    assert.strictEqual(depseekModule.depseek, depseekSync);
  });

  test('pairs a dependency with the following comment', () => {
    assert.deepEqual(
      strip(depseekSync('import "foo" // @2.x', { comments: true })),
      [
        { type: 'dep', value: 'foo' },
        { type: 'comment', value: ' @2.x' },
      ]
    );
  });

  test('omits comments unless requested', () => {
    assert.deepEqual(strip(depseekSync("require('a') // @1.0.0")), [
      { type: 'dep', value: 'a' },
    ]);
  });

  test('token indexes point at the token value', () => {
    const src = "const x = require('pkg') /* note */";
    for (const token of depseekSync(src, { comments: true })) {
      assert.strictEqual(
        src.slice(token.index, token.index + token.value.length),
        token.value
      );
    }
  });

  test('parses the zx parseDeps sample', () => {
    const content = `
      require('a') // @1.0.0
      const b =require('b') /* @2.0.0 */
      const c = {
        c:require('c') /* @3.0.0 */,
        d: await import('d') /* @4.0.0 */,
        ...require('e') /* @5.0.0 */
      }
      const f = [...require('f') /* @6.0.0 */]
      ;require('g'); // @7.0.0
      const h = 1 *require('h') // @8.0.0
      {require('i') /* @9.0.0 */}
      import 'j' // @10.0.0
      import fs from 'fs'
      // import aaa from 'a'
      /* import bbb from 'b' */
      import bar from "bar" /* @1.0.0 */
      import qux from "@qux/pkg/entry" //    @^3.0
      const cpy = await import('cpy')
      const { pick } = require("lodash") //  @4.17.15
    `;
    const deps = depseekSync(content, { comments: true })
      .filter((token) => token.type === 'dep')
      .map((token) => token.value);
    assert.deepEqual(deps, [
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'fs',
      'bar',
      '@qux/pkg/entry',
      'cpy',
      'lodash',
    ]);
    assert.deepEqual(versions(content), {
      a: '1.0.0',
      b: '2.0.0',
      c: '3.0.0',
      d: '4.0.0',
      e: '5.0.0',
      f: '6.0.0',
      g: '7.0.0',
      h: '8.0.0',
      i: '9.0.0',
      j: '10.0.0',
      fs: 'latest',
      bar: '1.0.0',
      '@qux/pkg/entry': '^3.0',
      cpy: 'latest',
      lodash: '4.17.15',
    });
  });

  test('ignores specifiers inside strings, comments and regexes', () => {
    const src = [
      `const s = "require('x') // not a comment"`,
      `const r = /\\/\\/ import 'y'/g`,
      '// import aaa from "a"',
      "/* require('b') */",
      "const t = `import('c')`",
    ].join('\n');
    assert.deepEqual(strip(depseekSync(src, { comments: true })), [
      { type: 'comment', value: ' import aaa from "a"' },
      { type: 'comment', value: " require('b') " },
    ]);
  });

  test('handles re-exports, template expressions and member calls', () => {
    const src = [
      "export * from './m'",
      'export { a } from "./n"',
      "import type { T } from 'types-pkg'",
      "const t = `${require('z')}`",
      "const q = a / b / import('q')",
      "obj.require('nope'); import.meta.url",
      'require(`tpl`)',
    ].join('\n');
    assert.deepEqual(
      depseekSync(src).map((token) => token.value),
      ['./m', './n', 'types-pkg', 'z', 'q', 'tpl']
    );
  });

  test('skips a leading hashbang', () => {
    assert.deepEqual(strip(depseekSync('#!/usr/bin/env zx\nimport "a"')), [
      { type: 'dep', value: 'a' },
    ]);
  });
});
