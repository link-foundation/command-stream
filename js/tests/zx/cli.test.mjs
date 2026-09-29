// Port of zx test/cli.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { $, path, tmpfile, tmpdir, fs } from '../../src/zx/index.mjs';
import { isMain, normalizeExt } from '../../src/zx/cli.mjs';
import { fakeServer } from './fixtures/server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Paths are resolved from this file: the suites run from the repo root (CI)
// as well as from js/.
const PKG_ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(PKG_ROOT, 'src/zx/cli.mjs');
const fixture = (name) => path.join(__dirname, 'fixtures', name);
const spawn = $.spawn;
const nodeMajor = +process.versions?.node?.split('.')[0];
const test22 = nodeMajor >= 22 ? test : test.skip;

describe('cli', () => {
  // Helps to detect unresolved ProcessPromise.
  before(() => {
    const spawned = [];
    $.spawn = (...args) => {
      const proc = spawn(...args);
      const done = () => (proc._done = true);
      spawned.push(proc);
      return proc.once('close', done).once('error', done);
    };
    process.on('exit', () => {
      if (spawned.some((p) => p._done !== true)) {
        console.error('Error: ProcessPromise never resolved.');
        process.exitCode = 1;
      }
    });
  });
  after(() => ($.spawn = spawn));

  test('[zx:test/cli.test.js:48:3:registration] promise resolved', async () => {
    await $`echo`;
  });

  test('[zx:test/cli.test.js:52:3:registration] prints version', async () => {
    assert.match((await $`node ${CLI} -v`).toString(), /\d+.\d+.\d+/);
  });

  test('[zx:test/cli.test.js:56:3:registration] prints help', async () => {
    const p = $`node ${CLI} -h`;
    p.stdin.end();
    const help = await p;
    assert.match(help.stdout, /zx/);
  });

  test('help names the package version and the mirrored zx version', async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')
    );
    const { VERSION } = await import('../../src/zx/index.mjs');
    const p = $`node ${CLI} -h`;
    p.stdin.end();
    const help = (await p).stdout.replace(/\u001B\[[\d;]*m/g, '');
    assert.ok(
      help.includes(`command-stream ${pkg.version} (zx ${VERSION} compatible)`),
      help
    );
  });

  test('[zx:test/cli.test.js:63:3:registration] zx prints usage if no param passed', async () => {
    const p = $`node ${CLI}`;
    p.stdin.end();
    try {
      await p;
      assert.fail('must throw');
    } catch (out) {
      assert.match(out.stdout, /A tool for writing better scripts/);
      assert.equal(out.exitCode, 1);
    }
  });

  test('[zx:test/cli.test.js:75:3:registration] starts repl with --repl', async () => {
    const p = $`node ${CLI} --repl`;
    p.stdin.write('await $`echo f"o"o`\n');
    p.stdin.write('"b"+"ar"\n');
    p.stdin.end();
    const out = await p;
    assert.match(out.stdout, /foo/);
    assert.match(out.stdout, /bar/);
  });

  test('[zx:test/cli.test.js:85:3:registration] starts repl with verbosity off', async () => {
    const p = $`node ${CLI} --repl`;
    p.stdin.write('"verbose" + " is " + $.verbose\n');
    p.stdin.end();
    const out = await p;
    assert.match(out.stdout, /verbose is false/);
  });

  test('[zx:test/cli.test.js:93:3:registration] supports `--quiet` flag', async () => {
    const p = await $`node ${CLI} --quiet ${fixture('markdown.md')}`;
    assert.ok(!p.stderr.includes('ignore'), 'ignore was printed');
    assert.ok(!p.stderr.includes('hello'), 'no hello');
    assert.ok(p.stdout.includes('world'), 'no world');
  });

  test('[zx:test/cli.test.js:100:3:registration] supports `--shell` flag ', async () => {
    const shell = $.shell;
    const p =
      await $`node ${CLI} --verbose --shell=${shell} <<< '$\`echo \${$.shell}\`'`;
    assert.ok(p.stderr.includes(shell));
  });

  test('[zx:test/cli.test.js:107:3:registration] supports `--prefix` flag ', async () => {
    const prefix = 'set -e;';
    const p =
      await $`node ${CLI} --verbose --prefix=${prefix} <<< '$\`echo \${$.prefix}\`'`;
    assert.ok(p.stderr.includes(prefix));
  });

  test('[zx:test/cli.test.js:114:3:registration] supports `--postfix` flag ', async () => {
    const postfix = '; exit 0';
    const p =
      await $`node ${CLI} --verbose --postfix=${postfix} <<< '$\`echo \${$.postfix}\`'`;
    assert.ok(p.stderr.includes(postfix));
  });

  test('[zx:test/cli.test.js:121:3:registration] supports `--cwd` option ', async () => {
    const cwd = tmpdir();
    fs.mkdirSync(cwd, { recursive: true });
    const p =
      await $`node ${CLI} --verbose --cwd=${cwd} <<< '$\`echo \${$.cwd}\`'`;
    assert.ok(p.stderr.endsWith(`${cwd}\n`));
  });

  test('[zx:test/cli.test.js:129:3:registration] supports `--env` option', async () => {
    const env = tmpfile(
      '.env',
      `FOO=BAR
      BAR=FOO+`
    );
    const file = `
    console.log((await $\`echo $FOO\`).stdout);
    console.log((await $\`echo $BAR\`).stdout)
    `;

    const out = await $`node ${CLI} --env=${env} <<< ${file}`;
    fs.remove(env);
    assert.equal(out.stdout, 'BAR\n\nFOO+\n\n');
  });

  test('[zx:test/cli.test.js:145:3:registration] supports `--env` and `--cwd` options with file', async () => {
    const env = tmpfile(
      '.env',
      `FOO=BAR
      BAR=FOO+`
    );
    const dir = tmpdir();
    const file = `
      console.log((await $\`echo $FOO\`).stdout);
      console.log((await $\`echo $BAR\`).stdout)
      `;

    const out = await $`node ${CLI} --cwd=${dir} --env=${env}  <<< ${file}`;
    fs.remove(env);
    fs.remove(dir);
    assert.equal(out.stdout, 'BAR\n\nFOO+\n\n');
  });

  test('[zx:test/cli.test.js:164:3:registration] supports handling errors with the `--env` option', async () => {
    const file = `
      console.log((await $\`echo $FOO\`).stdout);
      console.log((await $\`echo $BAR\`).stdout)
      `;
    try {
      await $`node ${CLI} --env=./env <<< ${file}`;
      // Upstream follows with an unreachable `fs.remove(env)` on an undefined
      // binding; the port drops it.
      assert.throw();
    } catch (e) {
      assert.equal(e.exitCode, 1);
    }
  });

  describe('`--prefer-local`', () => {
    const pkgIndex = `export const a = 'AAA'`;
    const pkgJson = {
      name: 'a',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    };
    const script = `
import {a} from 'a'
console.log(a);
`;

    test('[zx:test/cli.test.js:191:5:registration] true', async () => {
      const cwd = tmpdir();
      await fs.outputFile(path.join(cwd, 'node_modules/a/index.js'), pkgIndex);
      await fs.outputJson(
        path.join(cwd, 'node_modules/a/package.json'),
        pkgJson
      );

      const out =
        await $`node ${CLI} --cwd=${cwd} --prefer-local=true --test <<< ${script}`;
      assert.equal(out.stdout, 'AAA\n');
      assert.ok(await fs.exists(path.join(cwd, 'node_modules/a/index.js')));
    });

    test('[zx:test/cli.test.js:205:5:registration] external dir', async () => {
      const cwd = tmpdir();
      const external = tmpdir();
      await fs.outputFile(
        path.join(external, 'node_modules/a/index.js'),
        pkgIndex
      );
      await fs.outputJson(
        path.join(external, 'node_modules/a/package.json'),
        pkgJson
      );

      const out =
        await $`node ${CLI} --cwd=${cwd} --prefer-local=${external} --test <<< ${script}`;
      assert.equal(out.stdout, 'AAA\n');
      assert.ok(
        await fs.exists(path.join(external, 'node_modules/a/index.js'))
      );
    });

    test('[zx:test/cli.test.js:223:5:registration] external alias', async () => {
      const cwd = tmpdir();
      const external = tmpdir();
      await fs.outputFile(
        path.join(external, 'node_modules/a/index.js'),
        pkgIndex
      );
      await fs.outputJson(
        path.join(external, 'node_modules/a/package.json'),
        pkgJson
      );
      await fs.symlinkSync(
        path.join(external, 'node_modules'),
        path.join(cwd, 'node_modules'),
        'junction'
      );

      const out =
        await $`node ${CLI} --cwd=${cwd} --prefer-local=true --test <<< ${script}`;
      assert.equal(out.stdout, 'AAA\n');
      assert.ok(await fs.exists(path.join(cwd, 'node_modules')));
    });

    test('[zx:test/cli.test.js:246:5:registration] throws if exists', async () => {
      const cwd = tmpdir();
      const external = tmpdir();
      await fs.outputFile(path.join(cwd, 'node_modules/a/index.js'), pkgIndex);
      await fs.outputFile(
        path.join(external, 'node_modules/a/index.js'),
        pkgIndex
      );
      assert.rejects(
        () =>
          $`node ${CLI} --cwd=${cwd} --prefer-local=${external} --test <<< ${script}`,
        /node_modules already exists/
      );
    });

    test('[zx:test/cli.test.js:261:5:registration] throws if not dir', async () => {
      const cwd = tmpdir();
      const external = tmpdir();
      await fs.outputFile(path.join(external, 'node_modules'), pkgIndex);
      assert.rejects(
        () =>
          $`node ${CLI} --cwd=${cwd} --prefer-local=${external} --test <<< ${script}`,
        /node_modules doesn't exist or is not a directory/
      );
    });
  });

  test('[zx:test/cli.test.js:273:3:registration] scripts from https 200', async () => {
    const resp = await fs.readFile(fixture('echo.http'));
    const server = await fakeServer([resp]).start();
    const port = server.address().port;
    const out =
      await $`node ${CLI} --verbose http://127.0.0.1:${port}/script.mjs`;
    assert.match(out.stderr, /test/);
    await server.stop();
  });

  test('[zx:test/cli.test.js:283:3:registration] scripts from https 500', async () => {
    const server = await fakeServer([`HTTP/1.1 500\n\n500\n`]).start();
    const port = server.address().port;
    const out = await $`node ${CLI} http://127.0.0.1:${port}`.nothrow();
    assert.match(out.stderr, /Error: Can't get/);
    assert.match(out.stderr, /Failed to fetch remote script/);
    assert.equal(out.exitCode, 1);
    await server.stop();
  });

  test('[zx:test/cli.test.js:293:3:registration] scripts (md) from https', async () => {
    const resp = await fs.readFile(fixture('md.http'));
    const server = await fakeServer([resp]).start();
    const port = server.address().port;
    const out =
      await $`node ${CLI} --verbose http://127.0.0.1:${port}/script.md`;
    assert.match(out.stderr, /md/);
    await server.stop();
  });

  test('[zx:test/cli.test.js:303:3:registration] scripts with no extension', async () => {
    await $`node ${CLI} ${fixture('no-extension')}`;
    assert.ok(
      /Test file to verify no-extension didn't overwrite similarly name .mjs file./.test(
        (await fs.readFile(fixture('no-extension.mjs'))).toString()
      )
    );
  });

  test('[zx:test/cli.test.js:312:3:registration] scripts with non standard extension', async () => {
    const o = await $`node ${CLI} --ext='.mjs' ${fixture('non-std-ext.zx')}`;
    assert.ok(
      o.stdout
        .trim()
        .endsWith(path.join('zx', 'fixtures', 'non-std-ext.zx.mjs'))
    );

    await assert.rejects(
      $`node ${CLI} ${fixture('non-std-ext.zx')}`,
      /Unknown file extension "\.zx"/
    );
  });

  test22('scripts from stdin with explicit extension', async () => {
    const out =
      await $`node --experimental-strip-types ${CLI} --ext='.ts' <<< 'const foo: string = "bar"; console.log(foo)'`;
    assert.match(out.stdout, /bar/);
  });

  test('[zx:test/cli.test.js:329:3:registration] require() is working from stdin', async () => {
    const out = await $({
      cwd: PKG_ROOT,
    })`node ${CLI} <<< 'console.log(require("./package.json").name)'`;
    assert.match(out.stdout, /command-stream/);
  });

  test('[zx:test/cli.test.js:335:3:registration] require() is working in ESM', async () => {
    await $`node ${CLI} ${fixture('require.mjs')}`;
  });

  test('[zx:test/cli.test.js:339:3:registration] __filename & __dirname are defined', async () => {
    await $`node ${CLI} ${fixture('filename-dirname.mjs')}`;
  });

  test('[zx:test/cli.test.js:343:3:registration] markdown scripts are working', async () => {
    await $`node ${CLI} ${fixture('markdown.md')}`;
  });

  test('[zx:test/cli.test.js:347:3:registration] markdown scripts are working for CRLF', async () => {
    const p = await $`node ${CLI} ${fixture('markdown-crlf.md')}`;
    assert.ok(p.stdout.includes('Hello, world!'));
  });

  test('[zx:test/cli.test.js:352:3:registration] markdown scripts from stdin with --ext .md', async () => {
    const md = '# Test\n\n```js\necho("md-stdin-ok")\n```\n';
    const p = await $`node ${CLI} --ext='.md' <<< ${md}`;
    assert.match(p.stdout, /md-stdin-ok/);
  });

  test('[zx:test/cli.test.js:358:3:registration] exceptions are caught', async () => {
    const out1 = await $`node ${CLI} <<<${'await $`wtf`'}`.nothrow();
    const out2 = await $`node ${CLI} <<<'throw 42'`.nothrow();
    assert.match(out1.stderr, /Error:/);
    assert.match(out2.stderr, /42/);
  });

  test('[zx:test/cli.test.js:365:3:registration] eval works', async () => {
    assert.equal((await $`node ${CLI} --eval 'echo(42)'`).stdout, '42\n');
    assert.equal((await $`node ${CLI} -e='echo(69)'`).stdout, '69\n');
  });

  test('[zx:test/cli.test.js:370:3:registration] eval works with stdin', async () => {
    const p = $`(printf foo; sleep 0.1; printf bar) | node ${CLI} --eval 'echo(await stdin())'`;
    assert.equal((await p).stdout, 'foobar\n');
  });

  test('[zx:test/cli.test.js:375:3:registration] executes a script from $PATH', async () => {
    const isWindows = process.platform === 'win32';
    const oldPath = process.env.PATH;
    const toPOSIXPath = (_path) => _path.split(path.sep).join(path.posix.sep);

    const zxPath = CLI;
    const zxLocation = isWindows ? toPOSIXPath(zxPath) : zxPath;
    const scriptCode = `#!/usr/bin/env ${zxLocation}\nconsole.log('The script from path runs.')`;
    const scriptName = 'script-from-path';
    const scriptFile = tmpfile(scriptName, scriptCode, 0o744);
    const scriptDir = path.dirname(scriptFile);

    const envPathSeparator = isWindows ? ';' : ':';
    process.env.PATH += envPathSeparator + scriptDir;

    try {
      await $`chmod +x ${zxLocation}`;
      await $`${scriptName}`;
    } finally {
      process.env.PATH = oldPath;
      await fs.rm(scriptFile);
    }
  });

  test('[zx:test/cli.test.js:399:3:registration] argv works with zx and node', async () => {
    assert.equal(
      (await $`node ${CLI} ${fixture('argv.mjs')} foo`).toString(),
      `global {"_":["foo"]}\nimported {"_":["foo"]}\n`
    );
    assert.equal(
      (await $`node ${fixture('argv.mjs')} bar`).toString(),
      `global {"_":["bar"]}\nimported {"_":["bar"]}\n`
    );
    assert.equal(
      (
        await $`node ${CLI} --eval 'console.log(argv._.join(''))' baz`
      ).toString(),
      `baz\n`
    );
  });

  test('[zx:test/cli.test.js:416:3:registration] exit code can be set', async () => {
    const p = await $`node ${CLI} ${fixture('exit-code.mjs')}`.nothrow();
    assert.equal(p.exitCode, 42);
  });

  describe('internals', () => {
    test('[zx:test/cli.test.js:422:5:registration] isMain() checks process entry point', () => {
      assert.equal(isMain(import.meta.url, __filename), true);

      assert.equal(
        isMain(import.meta.url.replace('.js', '.cjs'), __filename),
        true
      );

      try {
        assert.equal(
          isMain(
            'file:///root/zx/test/cli.test.js',
            '/root/zx/test/all.test.js'
          ),
          true
        );
        assert.throw();
      } catch (e) {
        assert.ok(['EACCES', 'ENOENT'].includes(e.code));
      }
    });

    test('[zx:test/cli.test.js:444:5:registration] isMain() function is running from the wrong path', () => {
      assert.equal(isMain('///root/zx/test/cli.test.js'), false);
    });

    test('[zx:test/cli.test.js:448:5:registration] normalizeExt()', () => {
      assert.equal(normalizeExt('.ts'), '.ts');
      assert.equal(normalizeExt('ts'), '.ts');
      assert.equal(normalizeExt('.'), '.');
      assert.equal(normalizeExt(), undefined);
    });
  });
});
