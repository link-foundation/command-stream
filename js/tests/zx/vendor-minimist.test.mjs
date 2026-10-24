import { describe, test } from 'node:test';
import assert from 'node:assert';
import minimist from '../../src/zx/vendor/minimist.mjs';

describe('vendor/minimist', () => {
  test('parses the canonical example', () => {
    const argv = minimist(
      ['--foo', 'bar', '-a', '5', '-a', '42', '--force', './some.file'],
      { boolean: 'force' }
    );
    assert.deepEqual(argv, {
      a: [5, 42],
      foo: 'bar',
      force: true,
      _: ['./some.file'],
    });
  });

  test('handles short groups, numbers and --key=value', () => {
    const argv = minimist([
      '-x',
      '3',
      '-y',
      '4',
      '-n5',
      '-abc',
      '--beep=boop',
      'foo',
      'bar',
      '10',
    ]);
    assert.deepEqual(argv, {
      _: ['foo', 'bar', 10],
      x: 3,
      y: 4,
      n: 5,
      a: true,
      b: true,
      c: true,
      beep: 'boop',
    });
  });

  test('supports --no-* negation and dotted keys', () => {
    const argv = minimist(['--no-foo', '--a.b=1', '--a.c', 'x']);
    assert.deepEqual(argv, { _: [], foo: false, a: { b: 1, c: 'x' } });
  });

  test('keeps declared strings as strings', () => {
    const argv = minimist(['--num', '007', '-s', '--hex', '0x10'], {
      string: ['num', 's'],
    });
    assert.deepEqual(argv, { _: [], num: '007', s: '', hex: 16 });
  });

  test('boolean flags do not consume the next argument', () => {
    const argv = minimist(['--verbose', 'file.mjs', '-q', 'x'], {
      boolean: ['verbose', 'q'],
    });
    assert.deepEqual(argv, { _: ['file.mjs', 'x'], verbose: true, q: true });
  });

  test('boolean: true treats every long flag as boolean', () => {
    const argv = minimist(['--a', 'x', '--b=false'], { boolean: true });
    assert.deepEqual(argv, { _: ['x'], a: true, b: 'false' });
  });

  test('explicit true/false words set booleans', () => {
    const argv = minimist(['--debug', 'false', '-v', 'true'], {
      boolean: ['debug', 'v'],
    });
    assert.deepEqual(argv, { _: [], debug: false, v: true });
  });

  test('aliases are bidirectional and receive the same value', () => {
    const argv = minimist(['-o', 'out.txt', '--level', '2'], {
      alias: { o: 'output', l: ['level', 'lvl'] },
    });
    assert.deepEqual(argv, {
      _: [],
      o: 'out.txt',
      output: 'out.txt',
      level: 2,
      l: 2,
      lvl: 2,
    });
  });

  test('applies defaults to keys and their aliases', () => {
    const argv = minimist(['--port', '80'], {
      default: { port: 8080, host: 'localhost', 'a.b': 1 },
      alias: { host: 'H' },
    });
    assert.deepEqual(argv, {
      _: [],
      port: 80,
      host: 'localhost',
      H: 'localhost',
      a: { b: 1 },
    });
  });

  test('stopEarly collects everything after the first positional', () => {
    const argv = minimist(['--a', 'x', 'script.mjs', '--b', '-c'], {
      boolean: ['a'],
      stopEarly: true,
    });
    assert.deepEqual(argv, { _: ['x', 'script.mjs', '--b', '-c'], a: true });
  });

  test('handles the double dash separator', () => {
    assert.deepEqual(minimist(['--a', '1', '--', '--b', 'c']), {
      _: ['--b', 'c'],
      a: 1,
    });
    assert.deepEqual(minimist(['--a', '1', '--', '--b', 'c'], { '--': true }), {
      _: [],
      a: 1,
      '--': ['--b', 'c'],
    });
  });

  test('unknown() can drop undeclared flags and positionals', () => {
    const seen = [];
    const argv = minimist(['--known', 'v', '--other=1', 'pos'], {
      string: ['known'],
      unknown: (arg) => {
        seen.push(arg);
        return false;
      },
    });
    assert.deepEqual(argv, { _: [], known: 'v' });
    assert.deepEqual(seen, ['--other=1', 'pos']);
  });

  test('ignores prototype polluting keys', () => {
    const argv = minimist(['--__proto__.polluted=1', '--constructor=x']);
    assert.deepEqual(argv, { _: [] });
    assert.equal({}.polluted, undefined);
  });

  describe('zx cli options', () => {
    const opts = {
      string: ['shell', 'prefix', 'postfix', 'eval', 'cwd', 'ext', 'env'],
      boolean: [
        'version',
        'help',
        'quiet',
        'verbose',
        'install',
        'repl',
        'experimental',
        'prefer-local',
      ],
      alias: {
        e: 'eval',
        i: 'install',
        v: 'version',
        h: 'help',
        l: 'prefer-local',
        'env-file': 'env',
      },
      default: { 'prefer-local': false },
      stopEarly: true,
    };

    test('declared booleans and aliases default to false', () => {
      const argv = minimist(['script.mjs', '--foo', 'bar'], opts);
      assert.deepEqual(argv._, ['script.mjs', '--foo', 'bar']);
      for (const key of ['help', 'h', 'version', 'v', 'install', 'i']) {
        assert.strictEqual(argv[key], false, key);
      }
      assert.strictEqual(argv['prefer-local'], false);
      assert.strictEqual(argv.l, false);
    });

    test('short boolean aliases do not swallow the script path', () => {
      const argv = minimist(['-i', '-l', 'script.mjs', '-v'], opts);
      assert.strictEqual(argv.install, true);
      assert.strictEqual(argv.i, true);
      assert.strictEqual(argv['prefer-local'], true);
      assert.strictEqual(argv.l, true);
      assert.strictEqual(argv.v, false);
      assert.deepEqual(argv._, ['script.mjs', '-v']);
    });

    test('string options and their aliases keep raw values', () => {
      const argv = minimist(['-e', '1 + 1', '--env-file=.env.local'], opts);
      assert.strictEqual(argv.eval, '1 + 1');
      assert.strictEqual(argv.e, '1 + 1');
      assert.strictEqual(argv.env, '.env.local');
      assert.strictEqual(argv['env-file'], '.env.local');
    });
  });
});
