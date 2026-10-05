import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  globMatch,
  globWalk,
  globWalkSync,
  hasGlobSyntax,
} from '../src/bun-shell/glob.mjs';

const isWindows = process.platform === 'win32';

describe('globMatch', () => {
  const cases = [
    ['*', 'abc', true],
    ['*', 'a/b', false],
    ['*', '', true],
    ['**', 'a/b/c', true],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['a/**', 'a/', true],
    ['**/*.txt', 'x/y/z.txt', true],
    ['**/*.txt', 'z.md', false],
    ['?', 'a', true],
    ['?', '/', false],
    ['?', '日', true],
    ['??', '😀', false],
    ['[abc]', 'b', true],
    ['[!abc]', 'b', false],
    ['[^abc]', 'd', true],
    ['[a-z]*', 'hello', true],
    ['[é-ü]', 'ö', true],
    ['[é-ü]', 'z', false],
    ['[]]', ']', true],
    ['[abc', 'a', false],
    ['{a,b}', 'a', true],
    ['{a,b}', 'c', false],
    ['*.{js,ts}', 'x.ts', true],
    ['{a,{b,c}}d', 'cd', true],
    ['{,a}b', 'b', true],
    ['!*.md', 'x.txt', true],
    ['!*.md', 'x.md', false],
    ['!!a', 'a', true],
    ['\\*', '*', true],
    ['\\*', 'a', false],
    ['a\\', 'a', false],
    ['\\n', '\n', true],
    ['日本*', '日本語', true],
    ['*語', '日本語', true],
    ['a/*/c', 'a/b/c', true],
    ['a/*/c', 'a/b/x/c', false],
    ['', '', true],
    ['', 'a', false],
  ];
  for (const [pattern, input, expected] of cases) {
    test(`${JSON.stringify(pattern)} vs ${JSON.stringify(input)}`, () => {
      expect(globMatch(pattern, input)).toBe(expected);
    });
  }

  test('matches Bun.Glob on a fixed sample', () => {
    const patterns = ['*', '**/a', '{a,b}*', '[!x]?', 'a\\*', '*/é', '!a*'];
    const inputs = ['a', 'b', 'x/a', 'ab', 'a*', 'q/é', '', 'é'];
    for (const p of patterns) {
      for (const s of inputs) {
        expect([p, s, globMatch(p, s)]).toEqual([
          p,
          s,
          new Bun.Glob(p).match(s),
        ]);
      }
    }
  });

  test('deeply nested braces fail instead of recursing forever', () => {
    const p = `${'{a,'.repeat(12)}b${'}'.repeat(12)}`;
    expect(globMatch(p, 'b')).toBe(new Bun.Glob(p).match('b'));
  });
});

describe('hasGlobSyntax', () => {
  test('detects unescaped syntax', () => {
    expect(hasGlobSyntax('*.txt')).toBe(true);
    expect(hasGlobSyntax('a{b,c}')).toBe(true);
    expect(hasGlobSyntax('!a')).toBe(true);
    expect(hasGlobSyntax('a?')).toBe(true);
    expect(hasGlobSyntax('plain/path')).toBe(false);
    expect(hasGlobSyntax('\\*')).toBe(false);
    expect(hasGlobSyntax('\\\\*')).toBe(true);
  });
});

describe.skipIf(isWindows)('globWalkSync', () => {
  let root;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-shell-glob-'));
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    fs.mkdirSync(path.join(root, '.h'));
    fs.mkdirSync(path.join(root, 'é'));
    fs.writeFileSync(path.join(root, 'a', 'x.txt'), '');
    fs.writeFileSync(path.join(root, 'a', 'b', 'y.txt'), '');
    fs.writeFileSync(path.join(root, '.h', 'z'), '');
    fs.writeFileSync(path.join(root, 'é', '日本.txt'), '');
    fs.writeFileSync(path.join(root, 'top'), '');
    fs.writeFileSync(path.join(root, '.dot'), '');
    fs.symlinkSync('a', path.join(root, 'la'));
    fs.symlinkSync('top', path.join(root, 'lf'));
    fs.symlinkSync('nowhere', path.join(root, 'broken'));
    fs.symlinkSync('loop', path.join(root, 'loop'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const walk = (pattern, opts = {}) =>
    globWalkSync(pattern, { cwd: root, ...opts }).sort();
  const bun = (pattern, opts = {}) =>
    [...new Bun.Glob(pattern).scanSync({ cwd: root, ...opts })].sort();

  test('top-level files (symlinks are not followed by default)', () => {
    expect(walk('*')).toEqual(['top']);
    expect(walk('*', { followSymlinks: true })).toEqual(['lf', 'top']);
  });

  test('onlyFiles: false includes directories and links', () => {
    expect(walk('*', { onlyFiles: false })).toEqual([
      'a',
      'broken',
      'la',
      'lf',
      'loop',
      'top',
      'é',
    ]);
  });

  test('dot option', () => {
    expect(walk('*', { dot: true })).toEqual(['.dot', 'top']);
    expect(walk('.h/*')).toEqual(['.h/z']);
  });

  test('globstar', () => {
    expect(walk('**/*.txt')).toEqual(['a/b/y.txt', 'a/x.txt', 'é/日本.txt']);
    expect(walk('**', { onlyFiles: false })).toEqual(
      bun('**', { onlyFiles: false })
    );
  });

  test('followSymlinks descends into linked directories', () => {
    expect(walk('la/*')).toEqual(['la/x.txt']);
    expect(walk('**/*.txt', { followSymlinks: true })).toEqual([
      'a/b/y.txt',
      'a/x.txt',
      'la/b/y.txt',
      'la/x.txt',
      'é/日本.txt',
    ]);
  });

  test('absolute option', () => {
    expect(walk('a/*', { absolute: true })).toEqual([
      path.join(root, 'a', 'x.txt'),
    ]);
    expect(globWalkSync(`${root}/a/*`)).toEqual([
      path.join(root, 'a', 'x.txt'),
    ]);
  });

  test('dot segments and trailing separators', () => {
    expect(walk('./*')).toEqual(['./top']);
    expect(walk('a/../t*')).toEqual(['a/../top']);
    expect(walk('*/', { onlyFiles: false })).toEqual(['a', 'é']);
    expect(walk('./', { onlyFiles: false })).toEqual(['.']);
  });

  test('literal pattern', () => {
    expect(walk('a/x.txt')).toEqual(['a/x.txt']);
    expect(walk('a/missing')).toEqual([]);
    expect(globWalkSync('')).toEqual([]);
  });

  test('matches Bun.Glob for every option combination', () => {
    const patterns = ['*', '**', '*/*', '**/*.txt', 'l*/**', '{a,é}/*', '.*'];
    for (const pattern of patterns) {
      for (let bits = 0; bits < 32; bits++) {
        const opts = {
          dot: Boolean(bits & 1),
          absolute: Boolean(bits & 2),
          followSymlinks: Boolean(bits & 4),
          throwErrorOnBrokenSymlink: Boolean(bits & 8),
          onlyFiles: Boolean(bits & 16),
        };
        const run = (fn) => {
          try {
            return fn();
          } catch (e) {
            return [e.code, e.syscall, e.path, e.errno];
          }
        };
        const actual = run(() => globWalkSync(pattern, { cwd: root, ...opts }));
        const expected = run(() => [
          ...new Bun.Glob(pattern).scanSync({ cwd: root, ...opts }),
        ]);
        expect([pattern, bits, actual]).toEqual([pattern, bits, expected]);
      }
    }
  });

  test('missing cwd throws ENOENT', () => {
    let err;
    try {
      globWalkSync('*', { cwd: path.join(root, 'nope') });
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('ENOENT');
    expect(err.syscall).toBe('open');
    expect(err.path).toBe(path.join(root, 'nope'));
    expect(err.errno).toBe(-2);
  });

  test('cwd that is a file throws ENOTDIR', () => {
    expect(() => globWalkSync('*', { cwd: path.join(root, 'top') })).toThrow(
      expect.objectContaining({ code: 'ENOTDIR', syscall: 'open' })
    );
  });

  test('broken symlinks throw only when requested', () => {
    const opts = { cwd: root, followSymlinks: true, onlyFiles: false };
    expect(globWalkSync('broken', opts)).toEqual([]);
    expect(globWalkSync('b*', opts)).toEqual(['broken']);
    expect(() =>
      globWalkSync('b*', { ...opts, throwErrorOnBrokenSymlink: true })
    ).toThrow(
      expect.objectContaining({
        code: 'ENOENT',
        syscall: 'open',
        path: 'broken',
      })
    );
  });

  test('symlink loop in a literal pattern throws ELOOP', () => {
    expect(() => globWalkSync('loop', { cwd: root })).toThrow(
      expect.objectContaining({ code: 'ELOOP', syscall: 'fstatat' })
    );
  });

  test('invalid cwd type', () => {
    expect(() => globWalkSync('*', { cwd: 5 })).toThrow('not a string');
  });

  test('globWalk resolves and rejects like globWalkSync', async () => {
    expect(await globWalk('*', { cwd: root })).toEqual(['top']);
    await expect(
      globWalk('*', { cwd: path.join(root, 'nope') })
    ).rejects.toThrow('ENOENT');
  });
});
