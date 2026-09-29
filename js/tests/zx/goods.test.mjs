// Port of zx test/goods.test.ts (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { test, describe, after } from 'node:test';
import { Duplex, Writable } from 'node:stream';
import {
  $,
  chalk,
  fs,
  path,
  dotenv,
  ProcessOutput,
} from '../../src/zx/index.mjs';
import {
  echo,
  sleep,
  argv,
  parseArgv,
  updateArgv,
  stdin,
  spinner,
  fetch,
  retry,
  question,
  expBackoff,
  tempfile,
  tempdir,
  tmpdir,
  tmpfile,
  versions,
} from '../../src/zx/goods.mjs';
import process from 'node:process';
import { serveGitHubStub } from './fixtures/github-stub.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The package root (js/): the suites run from the repo root as well.
const root = path.resolve(__dirname, '../..');
const CLI = path.join(root, 'src/zx/cli.mjs');

describe('goods', () => {
  function zx(script) {
    return $`node ${CLI} --eval ${script}`.nothrow().timeout('5s');
  }

  describe('question()', async () => {
    test('[zx:test/goods.test.ts:49:5:registration] works', async () => {
      let contents = '';
      class Input extends Duplex {
        constructor() {
          super();
        }
        _read() {}
        _write(chunk, encoding, callback) {
          this.push(chunk);
          callback();
        }
        _final() {
          this.push(null);
        }
      }
      const input = new Input();
      const output = new Writable({
        write(chunk, encoding, next) {
          contents += chunk.toString();
          next();
        },
      });

      setTimeout(() => {
        input.write('foo\n');
        input.end();
      }, 10);
      const result = await question('foo or bar? ', {
        choices: ['foo', 'bar'],
        input,
        output,
      });

      assert.equal(result, 'foo');
      assert(contents.includes('foo or bar? '));
    });

    test('[zx:test/goods.test.ts:86:5:registration] integration', async () => {
      const p = $`node ${CLI} --eval "
  let answer = await question('foo or bar? ', { choices: ['foo', 'bar'] })
  echo('Answer is', answer)
"`;
      p.stdin.write('foo\n');
      p.stdin.end();
      assert.match((await p).stdout, /Answer is foo/);
    });
  });

  test('[zx:test/goods.test.ts:97:3:registration] echo() works', async () => {
    const log = console.log;
    let stdout = '';
    console.log = (...args) => {
      stdout += args.join(' ');
    };
    echo(chalk.cyan('foo'), chalk.green('bar'), chalk.bold('baz'));
    echo`${chalk.cyan('foo')} ${chalk.green('bar')} ${chalk.bold('baz')}`;
    echo(
      await $`echo ${chalk.cyan('foo')}`,
      await $`echo ${chalk.green('bar')}`,
      await $`echo ${chalk.bold('baz')}`
    );
    console.log = log;
    assert.match(stdout, /foo/);
  });

  test('[zx:test/goods.test.ts:114:3:registration] sleep() works', async () => {
    const now = Date.now();
    await sleep(100);
    assert.ok(Date.now() >= now + 99);
  });

  describe('retry()', () => {
    test('[zx:test/goods.test.ts:121:5:registration] works', async () => {
      let count = 0;
      const result = await retry(5, () => {
        count++;
        if (count < 5) {
          throw new Error('fail');
        }
        return 'success';
      });
      assert.equal(result, 'success');
      assert.equal(count, 5);
    });

    test('[zx:test/goods.test.ts:132:5:registration] works with custom delay and limit', async () => {
      const now = Date.now();
      let count = 0;
      try {
        await retry(3, '2ms', () => {
          count++;
          throw new Error('fail');
        });
      } catch (e) {
        assert.match(e.message, /fail/);
        assert.ok(Date.now() >= now + 4);
        assert.equal(count, 3);
      }
    });

    test('[zx:test/goods.test.ts:147:5:registration] throws undefined on count misconfiguration', async () => {
      try {
        await retry(0, () => 'ok');
      } catch (e) {
        assert.equal(e, undefined);
      }
    });

    test('[zx:test/goods.test.ts:155:5:registration] throws err on empty callback', async () => {
      try {
        // @ts-ignore
        await retry(5);
      } catch (e) {
        assert.match(e.message, /Callback is required for retry/);
      }
    });

    test('[zx:test/goods.test.ts:164:5:registration] supports expBackoff', async () => {
      const result = await retry(5, expBackoff('10ms'), () => {
        if (Math.random() < 0.1) {
          throw new Error('fail');
        }
        return 'success';
      });

      assert.equal(result, 'success');
    });

    test('[zx:test/goods.test.ts:173:5:registration] integration', async () => {
      const now = Date.now();
      const p = await zx(`
    try {
      await retry(5, '50ms', () => $\`exit 123\`)
    } catch (e) {
      echo('exitCode:', e.exitCode)
    }
    await retry(5, () => $\`exit 0\`)
    echo('success')
`);
      assert.ok(p.toString().includes('exitCode: 123'));
      assert.ok(p.toString().includes('success'));
      assert.ok(Date.now() >= now + 50 * (5 - 1));
    });

    test('[zx:test/goods.test.ts:189:5:registration] integration with expBackoff', async () => {
      const now = Date.now();
      const p = await zx(`
    try {
      await retry(5, expBackoff('60s', 0), () => $\`exit 123\`)
    } catch (e) {
      echo('exitCode:', e.exitCode)
    }
    echo('success')
`);
      assert.ok(p.toString().includes('exitCode: 123'));
      assert.ok(p.toString().includes('success'));
      assert.ok(Date.now() >= now + 2 + 4 + 8 + 16 + 32);
    });
  });

  test('[zx:test/goods.test.ts:205:3:registration] expBackoff()', async () => {
    const g = expBackoff('10s', '100ms');

    const [a, b, c] = [g.next().value, g.next().value, g.next().value];

    assert.equal(a, 100);
    assert.equal(b, 200);
    assert.equal(c, 400);
  });

  describe('spinner()', () => {
    test('[zx:test/goods.test.ts:220:5:registration] works', async () => {
      let contents = '';
      const { CI } = process.env;
      const output = new Writable({
        write(chunk, encoding, next) {
          contents += chunk.toString();
          next();
        },
      });

      delete process.env.CI;
      $.log.output = output;

      const p = spinner(() => sleep(100));

      delete $.log.output;
      process.env.CI = CI;

      await p;
      assert(contents.includes('⠋'));
    });

    describe('integration', () => {
      test('[zx:test/goods.test.ts:243:7:registration] works', async () => {
        const out = await zx(
          `
    process.env.CI = ''
    echo(await spinner(async () => {
      await sleep(100)
      await $\`echo hidden\`
      return $\`echo result\`
    }))
  `
        );
        assert(out.stdout.includes('result'));
        assert(out.stderr.includes('⠋'));
        assert(!out.stderr.includes('result'));
        assert(!out.stderr.includes('hidden'));
      });

      test('[zx:test/goods.test.ts:260:7:registration] with title', async () => {
        const out = await zx(
          `
    process.env.CI = ''
    await spinner('processing', () => sleep(100))
  `
        );
        assert.match(out.stderr, /processing/);
      });

      test('[zx:test/goods.test.ts:270:7:registration] disabled in CI', async () => {
        const out = await zx(
          `
    process.env.CI = 'true'
    await spinner('processing', () => sleep(100))
  `
        );
        assert.doesNotMatch(out.stderr, /processing/);
      });

      test('[zx:test/goods.test.ts:280:7:registration] stops on throw', async () => {
        const out = await zx(`
    await spinner('processing', () => $\`wtf-cmd\`)
  `);
        assert.match(out.stderr, /Error:/);
        assert(out.exitCode !== 0);
      });
    });
  });

  describe('args', () => {
    test('[zx:test/goods.test.ts:291:5:registration] parseArgv() works', () => {
      assert.deepEqual(
        parseArgv(
          // prettier-ignore
          [
          '--foo-bar', 'baz',
          '-a', '5',
          '-a', '42',
          '--aaa', 'AAA',
          '--force',
          './some.file',
          '--b1', 'true',
          '--b2', 'false',
          '--b3',
          '--b4', 'false',
          '--b5', 'true',
          '--b6', 'str'
        ],
          {
            boolean: ['force', 'b3', 'b4', 'b5', 'b6'],
            camelCase: true,
            parseBoolean: true,
            alias: { a: 'aaa' },
          },
          {
            def: 'def',
          }
        ),
        {
          a: [5, 42, 'AAA'],
          aaa: [5, 42, 'AAA'],
          fooBar: 'baz',
          force: true,
          _: ['./some.file', 'str'],
          b1: true,
          b2: false,
          b3: true,
          b4: false,
          b5: true,
          b6: true,
          def: 'def',
        }
      );
    });

    test('[zx:test/goods.test.ts:336:5:registration] updateArgv() works', () => {
      updateArgv(['--foo', 'bar']);
      assert.deepEqual(argv, {
        _: [],
        foo: 'bar',
      });
    });
  });

  test('[zx:test/goods.test.ts:345:3:registration] stdin()', async () => {
    const stream = fs.createReadStream(path.resolve(root, 'package.json'));
    const input = await stdin(stream);
    // Upstream reads zx's own package.json; ours is command-stream's.
    assert.match(input, /"name": "command-stream"/);
  });

  test('[zx:test/goods.test.ts:351:3:registration] fetch()', async () => {
    // Upstream requests https://github.com/; see fixtures/github-stub.mjs.
    const github = await serveGitHubStub();
    try {
      const req1 = fetch(github.url);
      const req2 = fetch(github.url);
      const req3 = fetch(github.url, { method: 'OPTIONS' });

      const p1 = (await req1.pipe`cat`).stdout;
      const p2 = (await req2.pipe($`cat`)).stdout;
      const p3 = (await req3.pipe`cat`).stdout;

      assert.equal((await req1).status, 200);
      assert.equal((await req2).status, 200);
      assert.equal((await req3).status, 404);
      assert(p1.includes('GitHub'));
      assert(p2.includes('GitHub'));
      assert(p3.includes('GitHub'));
    } finally {
      await github.close();
    }
  });

  // Upstream calls `abort()` on the halted command, which throws because no
  // process was spawned, so the pipe never settles.
  test('fetch().pipe rejects when the request fails', async () => {
    const github = await serveGitHubStub();
    await github.close();
    await assert.rejects(fetch(github.url).pipe`cat`, (err) => {
      assert(err instanceof ProcessOutput);
      assert.match(err.message, /fetch failed|Unable to connect/i);
      return true;
    });
  });

  describe('dotenv', () => {
    test('[zx:test/goods.test.ts:369:5:registration] parse()', () => {
      assert.deepEqual(dotenv.parse(''), {});
      assert.deepEqual(
        dotenv.parse('ENV=v1\nENV2=v2\n\n\n  ENV3  =    v3   \nexport ENV4=v4'),
        {
          ENV: 'v1',
          ENV2: 'v2',
          ENV3: 'v3',
          ENV4: 'v4',
        }
      );

      const multiline = `SIMPLE=xyz123
# comment ###
NON_INTERPOLATED='raw text without variable interpolation' 
MULTILINE = """
long text here, # not-comment
e.g. a private SSH key
"""
ENV=v1\nENV2=v2\n\n\n\t\t  ENV3  =    v3   \n   export ENV4=v4
ENV5=v5 # comment
`;
      assert.deepEqual(dotenv.parse(multiline), {
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

    describe('load()', () => {
      const file1 = tempfile('.env.1', 'ENV1=value1\nENV2=value2');
      const file2 = tempfile('.env.2', 'ENV2=value222\nENV3=value3');
      after(() => Promise.all([fs.remove(file1), fs.remove(file2)]));

      test('[zx:test/goods.test.ts:408:7:registration] loads env from files', () => {
        const env = dotenv.load(file1, file2);
        assert.equal(env.ENV1, 'value1');
        assert.equal(env.ENV2, 'value2');
        assert.equal(env.ENV3, 'value3');
      });

      test('[zx:test/goods.test.ts:415:7:registration] throws error on ENOENT', () => {
        try {
          dotenv.load('./.env');
          throw new Error('unreachable');
        } catch (e) {
          assert.equal(e.code, 'ENOENT');
          // libuv's UV_ENOENT is -4058 on Windows.
          assert.equal(e.errno, process.platform === 'win32' ? -4058 : -2);
        }
      });
    });

    describe('loadSafe()', () => {
      const file1 = tempfile('.env.1', 'ENV1=value1\nENV2=value2');
      const file2 = '.env.notexists';

      after(() => fs.remove(file1));

      test('[zx:test/goods.test.ts:432:7:registration] loads env from files', () => {
        const env = dotenv.loadSafe(file1, file2);
        assert.equal(env.ENV1, 'value1');
        assert.equal(env.ENV2, 'value2');
      });
    });

    describe('config()', () => {
      test('[zx:test/goods.test.ts:440:7:registration] updates process.env', () => {
        const file1 = tempfile('.env.1', 'ENV1=value1');

        assert.equal(process.env.ENV1, undefined);
        dotenv.config(file1);
        assert.equal(process.env.ENV1, 'value1');
        delete process.env.ENV1;
      });
    });
  });

  describe('temp*', () => {
    // The upstream patterns use `/`; Windows paths use `\`.
    const slash = (p) => p.split(path.sep).join('/');

    test('[zx:test/goods.test.ts:452:5:registration] tempdir() creates temporary folders', () => {
      assert.equal(tmpdir, tempdir);
      assert.match(slash(tempdir()), /\/zx-/);
      assert.match(slash(tempdir('foo')), /\/foo$/);
    });

    test('[zx:test/goods.test.ts:458:5:registration] tempfile() creates temporary files', () => {
      assert.equal(tmpfile, tempfile);
      assert.match(slash(tempfile()), /\/zx-.+/);
      assert.match(slash(tempfile('foo.txt')), /\/zx-.+\/foo\.txt$/);

      const tf = tempfile('bar.txt', 'bar');
      assert.match(slash(tf), /\/zx-.+\/bar\.txt$/);
      assert.equal(fs.readFileSync(tf, 'utf-8'), 'bar');
    });
  });

  describe('versions', () => {
    test('[zx:test/goods.test.ts:470:5:registration] exports deps versions', () => {
      assert.deepEqual(
        Object.keys(versions).sort(),
        [
          'chalk',
          'depseek',
          'dotenv',
          'fetch',
          'fs',
          'glob',
          'minimist',
          'ps',
          'which',
          'yaml',
          'zx',
        ].sort()
      );
    });
  });
});
