import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import glob, {
  globby,
  globbySync,
  globbyStream,
  generateGlobTasksSync,
  isDynamicPattern,
  convertPathToPattern,
  globToRegExp,
} from '../../src/zx/vendor/glob.mjs';

const FILES = [
  'README.md',
  'notes.txt',
  '.hidden',
  'src/index.js',
  'src/util.ts',
  'src/Upper.JS',
  'src/sub/deep.js',
  'src/sub/more/deeper.js',
  'src/.private/secret.js',
  'lib/a1.js',
  'lib/a2.js',
  'lib/a10.js',
  'lib/b(1).js',
  'build/out.js',
  'logs/app.log',
  'pkg/.gitignore',
  'pkg/keep.js',
  'pkg/temp/t.js',
];

describe('vendor/glob', () => {
  let cwd;

  before(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
    for (const file of FILES) {
      const abs = path.join(cwd, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
    }
    fs.mkdirSync(path.join(cwd, 'empty'));
    fs.writeFileSync(
      path.join(cwd, '.gitignore'),
      '# comment\nbuild/\n*.log\n'
    );
    fs.writeFileSync(path.join(cwd, 'pkg/.gitignore'), 'temp\n');
  });

  after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('exposes the globby API', () => {
    for (const name of [
      'globby',
      'sync',
      'globbySync',
      'globbyStream',
      'generateGlobTasks',
      'generateGlobTasksSync',
      'isDynamicPattern',
      'isGitIgnored',
      'isGitIgnoredSync',
      'convertPathToPattern',
    ]) {
      assert.equal(typeof glob[name], 'function', name);
    }
    assert.equal(glob.globby, globby);
    assert.equal(glob.sync, globbySync);
  });

  test('matches *.md in cwd (async and sync)', async () => {
    assert.deepEqual(await glob('*.md', { cwd }), ['README.md']);
    assert.deepEqual(glob.sync('*.md', { cwd }), ['README.md']);
  });

  test('uses process.cwd() by default', async () => {
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      assert.deepEqual(await glob('*.md'), ['README.md']);
      assert.deepEqual(glob.sync('*.md'), ['README.md']);
    } finally {
      process.chdir(prev);
    }
  });

  test('accepts URL cwd', () => {
    const url = pathToFileURL(cwd);
    assert.deepEqual(glob.sync('*.txt', { cwd: url }), ['notes.txt']);
  });

  test('globstar, braces and ranges', () => {
    assert.deepEqual(glob.sync('src/**/*.js', { cwd }), [
      'src/index.js',
      'src/sub/deep.js',
      'src/sub/more/deeper.js',
    ]);
    assert.deepEqual(glob.sync('src/*.{js,ts}', { cwd }), [
      'src/index.js',
      'src/util.ts',
    ]);
    assert.deepEqual(glob.sync('lib/a{1..10}.js', { cwd }).sort(), [
      'lib/a1.js',
      'lib/a10.js',
      'lib/a2.js',
    ]);
  });

  test('character classes, ? and extglobs', () => {
    assert.deepEqual(glob.sync('lib/a[0-9].js', { cwd }), [
      'lib/a1.js',
      'lib/a2.js',
    ]);
    assert.deepEqual(glob.sync('lib/a[!1].js', { cwd }), ['lib/a2.js']);
    assert.deepEqual(glob.sync('lib/a?.js', { cwd }), [
      'lib/a1.js',
      'lib/a2.js',
    ]);
    assert.deepEqual(glob.sync('src/@(index|util).*', { cwd }), [
      'src/index.js',
      'src/util.ts',
    ]);
    assert.deepEqual(glob.sync('src/!(index).js', { cwd }), []);
    assert.deepEqual(glob.sync('src/!(index).ts', { cwd }), ['src/util.ts']);
    assert.deepEqual(glob.sync('lib/b\\(1\\).js', { cwd }), ['lib/b(1).js']);
  });

  test('negative patterns and ignore option', () => {
    assert.deepEqual(glob.sync(['src/**/*.js', '!src/sub/**'], { cwd }), [
      'src/index.js',
    ]);
    assert.deepEqual(
      glob.sync('src/**/*.js', { cwd, ignore: ['**/more/**'] }),
      ['src/index.js', 'src/sub/deep.js']
    );
  });

  test('dot, deep, onlyDirectories and markDirectories', () => {
    assert.deepEqual(glob.sync('*', { cwd, dot: true }), [
      '.gitignore',
      '.hidden',
      'README.md',
      'notes.txt',
    ]);
    assert.deepEqual(glob.sync('src/**/*.js', { cwd, deep: 2 }), [
      'src/index.js',
      'src/sub/deep.js',
    ]);
    assert.deepEqual(glob.sync('src/*', { cwd, onlyDirectories: true }), [
      'src/sub',
    ]);
    assert.deepEqual(
      glob.sync('*', { cwd, onlyFiles: false, markDirectories: true }),
      [
        'README.md',
        'build/',
        'empty/',
        'lib/',
        'logs/',
        'notes.txt',
        'pkg/',
        'src/',
      ]
    );
  });

  test('absolute paths, case-insensitivity and baseNameMatch', () => {
    const abs = glob.sync('*.md', { cwd, absolute: true });
    assert.equal(abs.length, 1);
    assert.ok(path.isAbsolute(abs[0]));
    assert.ok(!abs[0].includes('\\'));
    assert.ok(abs[0].endsWith('/README.md'));
    assert.deepEqual(
      glob.sync('src/*.js', { cwd, caseSensitiveMatch: false }),
      ['src/Upper.JS', 'src/index.js']
    );
    assert.deepEqual(glob.sync('deep*.js', { cwd, baseNameMatch: true }), [
      'src/sub/deep.js',
      'src/sub/more/deeper.js',
    ]);
  });

  test('expands directories and keeps ./ prefix', () => {
    assert.deepEqual(glob.sync('lib', { cwd }), [
      'lib/a1.js',
      'lib/a10.js',
      'lib/a2.js',
      'lib/b(1).js',
    ]);
    assert.deepEqual(glob.sync('lib', { cwd, expandDirectories: false }), []);
    assert.deepEqual(glob.sync('./src/*.ts', { cwd }), ['./src/util.ts']);
  });

  test('objectMode and stats', () => {
    const [entry] = glob.sync('*.md', { cwd, stats: true });
    assert.equal(entry.name, 'README.md');
    assert.equal(entry.path, 'README.md');
    assert.ok(entry.dirent.isFile());
    assert.equal(typeof entry.stats.size, 'number');
  });

  test('respects .gitignore files', async () => {
    const expected = [
      'README.md',
      'notes.txt',
      'lib/a1.js',
      'lib/a10.js',
      'lib/a2.js',
      'lib/b(1).js',
      'pkg/keep.js',
      'src/Upper.JS',
      'src/index.js',
      'src/util.ts',
      'src/sub/deep.js',
      'src/sub/more/deeper.js',
    ];
    assert.deepEqual(await glob('**', { cwd, gitignore: true }), expected);
    assert.deepEqual(glob.sync('**', { cwd, gitignore: true }), expected);
    const isIgnored = await glob.isGitIgnored({ cwd });
    const isIgnoredSync = glob.isGitIgnoredSync({ cwd });
    for (const check of [isIgnored, isIgnoredSync]) {
      assert.equal(check('build/out.js'), true);
      assert.equal(check('logs/app.log'), true);
      assert.equal(check('pkg/temp/t.js'), true);
      assert.equal(check(path.join(cwd, 'logs/app.log')), true);
      assert.equal(check('pkg/keep.js'), false);
      assert.equal(check('README.md'), false);
    }
  });

  test('streams results', async () => {
    const out = [];
    for await (const entry of globbyStream('src/**/*.ts', { cwd })) {
      out.push(entry);
    }
    assert.deepEqual(out, ['src/util.ts']);
  });

  test('generates tasks', () => {
    const tasks = generateGlobTasksSync(['*.js', '!a.js', 'src/*.ts'], {
      cwd,
    });
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks[0].patterns, ['*.js']);
    assert.deepEqual(tasks[0].options.ignore, ['a.js']);
    assert.deepEqual(tasks[1].patterns, ['src/*.ts']);
  });

  test('rejects invalid patterns', async () => {
    assert.throws(() => glob.sync(42), TypeError);
    await assert.rejects(glob(42), TypeError);
  });

  test('pattern helpers', () => {
    assert.equal(isDynamicPattern('a/b.js'), false);
    assert.equal(isDynamicPattern('a/*.js'), true);
    assert.equal(isDynamicPattern('a/{b,c}.js'), true);
    assert.equal(isDynamicPattern('a', { caseSensitiveMatch: false }), true);
    assert.equal(convertPathToPattern('a/[b]/(c)'), 'a/\\[b\\]/\\(c\\)');
    const re = globToRegExp('src/**/*.js');
    assert.ok(re.test('src/a.js'));
    assert.ok(re.test('src/x/y/a.js'));
    assert.ok(!re.test('src/.x/a.js'));
    assert.ok(globToRegExp('src/**/*.js', { dot: true }).test('src/.x/a.js'));
    assert.ok(!re.test('lib/a.js'));
  });
});
