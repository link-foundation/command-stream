// Port of zx test/deps.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { test, describe } from 'node:test';
import { $, tmpfile, tmpdir, fs, path } from '../../src/zx/index.mjs';
import { installDeps, parseDeps } from '../../src/zx/deps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The package root (js/): the suites run from the repo root as well.
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src/zx/cli.mjs');

describe('deps', () => {
  describe('installDeps()', () => {
    const pkgjson = tmpfile(
      'package.json',
      '{"name": "temp", "version": "0.0.0"}'
    );
    const cwd = path.dirname(pkgjson);
    const t$ = $({ cwd });
    const load = (dep) =>
      fs.readJsonSync(path.join(cwd, 'node_modules', dep, 'package.json'));

    test('[zx:test/deps.test.js:35:5:registration] loader works via JS API', async () => {
      await installDeps(
        {
          cpy: '9.0.1',
          'lodash-es': '4.17.21',
        },
        cwd
      );
      assert(load('cpy').name === 'cpy');
      assert(load('lodash-es').name === 'lodash-es');
    });

    test('[zx:test/deps.test.js:47:5:registration] loader works via JS API with custom npm registry URL', async () => {
      await installDeps(
        {
          '@jsr/std__internal': '1.0.5',
        },
        cwd,
        'https://npm.jsr.io'
      );

      assert(load('@jsr/std__internal').name === '@jsr/std__internal');
    });

    test('[zx:test/deps.test.js:59:5:registration] loader works via CLI', async () => {
      const out =
        await t$`node ${cli} --install <<< 'import _ from "lodash" /* @4.17.15 */; console.log(_.VERSION)'`;
      assert.match(out.stdout, /4.17.15/);
    });

    test('[zx:test/deps.test.js:65:5:registration] loader works via CLI with custom npm registry URL', async () => {
      const code =
        'import { diff } from "@jsr/std__internal";console.log(diff instanceof Function)';
      const file = tmpfile('index.mjs', code);

      let out = await t$`node ${cli} --i --registry=https://npm.jsr.io ${file}`;
      fs.remove(file);
      assert.match(out.stdout, /true/);

      out = await t$`node ${cli}  -i --registry=https://npm.jsr.io <<< ${code}`;
      assert.match(out.stdout, /true/);
    });

    test('[zx:test/deps.test.js:78:5:registration] throws on invalid installer type', async () => {
      await assert.rejects(
        () =>
          installDeps({ foo: 'latest' }, cwd, 'https://npm.jsr.io', 'invalid'),
        {
          message: /Unsupported installer type: invalid. Supported types: npm/,
        }
      );
    });

    test('[zx:test/deps.test.js:88:5:registration] does nothing on empty deps', async () => {
      const cwd = tmpdir();
      await installDeps({}, cwd);
      assert(!fs.existsSync(path.join(cwd, 'node_modules')));
    });
  });

  describe('parseDeps()', () => {
    test('[zx:test/deps.test.js:96:5:registration] import or require', async () => {
      [
        [`import "foo"`, { foo: 'latest' }],
        [`import "foo"`, { foo: 'latest' }],
        [`import * as bar from "foo"`, { foo: 'latest' }],
        [`import('foo')`, { foo: 'latest' }],
        [`require('foo')`, { foo: 'latest' }],
        [`require('foo/bar')`, { foo: 'latest' }],
        [`require('foo/bar.js')`, { foo: 'latest' }],
        [`require('foo-bar')`, { 'foo-bar': 'latest' }],
        [`require('foo_bar')`, { foo_bar: 'latest' }],
        [`require('@foo/bar')`, { '@foo/bar': 'latest' }],
        [`require('@foo/bar/baz')`, { '@foo/bar': 'latest' }],
        [`require('foo.js')`, { 'foo.js': 'latest' }],

        // ignores local deps
        [`import '.'`, {}],
        [`require('.')`, {}],
        [`require('..')`, {}],
        [`require('../foo.js')`, {}],
        [`require('./foo.js')`, {}],

        // ignores invalid pkg names
        [`require('_foo')`, {}],
        [`require('@')`, {}],
        [`require('@/_foo')`, {}],
        [`require('@foo')`, {}],
        // ignores protocol specifiers
        [`import fs from 'node:fs'`, {}],
        [`require('node:path')`, {}],
        [`import('node:crypto')`, {}],
        [`import { promises } from 'node:fs/promises'`, {}],
        [`import * as assert from 'node:assert/strict'`, {}],
      ].forEach(([input, result]) => {
        assert.deepEqual(parseDeps(input), result);
      });
    });

    test('[zx:test/deps.test.js:134:5:registration] import with org and filename', async () => {
      assert.deepEqual(parseDeps(`import "@foo/bar/file"`), {
        '@foo/bar': 'latest',
      });
    });

    test('[zx:test/deps.test.js:140:5:registration] import with version', async () => {
      assert.deepEqual(parseDeps(`import "foo" // @2.x`), { foo: '2.x' });
      assert.deepEqual(parseDeps(`import "foo" // @^7`), { foo: '^7' });
      assert.deepEqual(parseDeps(`import "foo" /* @1.2.x */`), {
        foo: '1.2.x',
      });
    });

    test('[zx:test/deps.test.js:146:5:registration] multiline', () => {
      const contents = `
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
  import path from 'path'
  import foo from "foo"
  // import aaa from 'a'
  /* import bbb from 'b' */
  import bar from "bar" /* @1.0.0 */
  import baz from "baz" //    @^2.0
  import qux from "@qux/pkg/entry" //    @^3.0
  import {api as alias} from "qux/entry/index.js" // @^4.0.0-beta.0

  const cpy = await import('cpy')
  const { pick } = require("lodash") //  @4.17.15
  `;

      assert.deepEqual(parseDeps(contents), {
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
        foo: 'latest',
        bar: '1.0.0',
        baz: '^2.0',
        '@qux/pkg': '^3.0',
        qux: '^4.0.0-beta.0',
        cpy: 'latest',
        lodash: '4.17.15',
      });
    });
  });
});
