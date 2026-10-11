import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv, {
  parse,
  stringify,
  load,
  loadSafe,
  config,
} from '../../src/zx/vendor/dotenv.mjs';

describe('vendor/dotenv', () => {
  let dir;
  let file1;
  let file2;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-zx-dotenv-'));
    file1 = path.join(dir, '.env.1');
    file2 = path.join(dir, '.env.2');
    fs.writeFileSync(file1, 'ENV1=value1\nENV2=value2');
    fs.writeFileSync(file2, 'ENV2=value222\nENV3=value3');
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('exposes the envapi surface', () => {
    assert.deepEqual(Object.keys(dotenv).sort(), [
      'config',
      'load',
      'loadSafe',
      'parse',
      'stringify',
    ]);
    assert.strictEqual(dotenv.parse, parse);
  });

  test('parses the spec example', () => {
    const input = [
      'SIMPLE=xyz123',
      '# comment ###',
      "NON_INTERPOLATED='raw text without variable interpolation' ",
      'MULTILINE = """',
      'long text here, # not-comment',
      'e.g. a private SSH key',
      '"""',
      'ENV=v1',
      'ENV2=v2',
      '',
      '',
      '\t\t  ENV3  =    v3   ',
      '   export ENV4=v4',
      'ENV5=v5 # comment',
    ].join('\n');
    assert.deepEqual(parse(input), {
      SIMPLE: 'xyz123',
      NON_INTERPOLATED: 'raw text without variable interpolation',
      MULTILINE: 'long text here, # not-comment\ne.g. a private SSH key',
      ENV: 'v1',
      ENV2: 'v2',
      ENV3: 'v3',
      ENV4: 'v4',
      ENV5: 'v5',
    });
  });

  test('parses empty input', () => {
    assert.deepEqual(parse(''), {});
  });

  test('keeps quoted content raw', () => {
    const env = parse(
      [
        'A="double # not comment"',
        "B='single'",
        'C=`back tick`',
        'D="multi',
        'line"',
        'E=',
        'F=a#b',
        'G="""inline triple"""',
      ].join('\r\n')
    );
    assert.deepEqual(env, {
      A: 'double # not comment',
      B: 'single',
      C: 'back tick',
      D: 'multi\nline',
      E: '',
      F: 'a#b',
      G: 'inline triple',
    });
  });

  test('stringify round-trips through parse', () => {
    const env = {
      PLAIN: 'value',
      SPACES: 'with spaces',
      HASH: '#hash',
      SINGLE: "it's",
      DOUBLE: 'say "hi"',
      ALL: '`a` "b" \'c\'',
      MULTI: 'line1\nline2\n',
      LEADING: '  padded  ',
      EMPTY: '',
      BACKSLASH: "back\\slash 'q'",
    };
    const text = stringify(env);
    assert.match(text, /^PLAIN=value$/m);
    assert.deepEqual(parse(text), env);
  });

  test('load() merges files with earlier files taking precedence', () => {
    const env = load(file1, file2);
    assert.strictEqual(env.ENV1, 'value1');
    assert.strictEqual(env.ENV2, 'value2');
    assert.strictEqual(env.ENV3, 'value3');
  });

  test('load() throws the native ENOENT error', () => {
    assert.throws(
      () => load(path.join(dir, 'missing.env')),
      (error) => {
        assert.strictEqual(error.code, 'ENOENT');
        if (process.platform !== 'win32') {
          assert.strictEqual(error.errno, -2);
        }
        return true;
      }
    );
  });

  test('loadSafe() skips missing files', () => {
    const env = loadSafe(path.join(dir, 'missing.env'), file2);
    assert.deepEqual(env, { ENV2: 'value222', ENV3: 'value3' });
  });

  test('config() populates process.env without overriding', () => {
    const file = path.join(dir, '.env.config');
    const a = 'CS_ZX_DOTENV_TEST_A';
    const b = 'CS_ZX_DOTENV_TEST_B';
    fs.writeFileSync(file, `${a}=from-file\n${b}=from-file`);
    delete process.env[a];
    process.env[b] = 'preset';
    try {
      const env = config(file);
      assert.deepEqual(env, { [a]: 'from-file', [b]: 'from-file' });
      assert.strictEqual(process.env[a], 'from-file');
      assert.strictEqual(process.env[b], 'preset');
    } finally {
      delete process.env[a];
      delete process.env[b];
    }
  });

  test('config() tolerates a missing default file', () => {
    assert.deepEqual(config(path.join(dir, 'nope.env')), {});
  });
});
