import { afterEach, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, shelljs } from '../src/$.mjs';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const tempDirectories = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'command-stream-shelljs-'));
  tempDirectories.push(directory);
  writeFileSync(join(directory, 'file with spaces.txt'), 'z\na\na\nb\n');
  return directory;
}
afterEach(() => {
  process.chdir(cwd);
  if (shelljs?.config) {
    shelljs.config.reset();
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ShellJS compatibility entry points', () => {
  test('$.shelljs, named export, ESM and CommonJS entries share the pinned implementation', async () => {
    const esm = await import('../src/shelljs/index.mjs');
    const cjs = require('../src/shelljs/index.cjs');
    const upstream = require('shelljs');
    expect($.shelljs).toBe(shelljs);
    expect(esm.default).toBe(shelljs);
    expect(cjs).toBe(shelljs);
    expect(require('../src/$.cjs').shelljs).toBe(shelljs);
    expect(shelljs).toBe(upstream);
    expect(Object.keys(shelljs).sort()).toEqual(Object.keys(upstream).sort());
  });

  test('preserves separate arguments, array operands, globs, option objects and ShellString pipelines', async () => {
    const directory = fixture();
    shelljs.config.silent = true;
    expect(shelljs.cd(directory).code).toBe(0);
    expect(shelljs.head({ '-n': 2 }, ['file with spaces.txt']).stdout).toBe(
      'z\na\n'
    );
    expect(shelljs.cat('*.txt').sort().uniq('-c').stdout).toBe(
      '      2 a\n      1 b\n      1 z\n'
    );
    expect(shelljs.echo('one', 'two words').stdout).toBe('one two words\n');
    const result = await shelljs.tail('-n', '2', 'file with spaces.txt');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('a\nb\n');
  });

  test('keeps nonzero codes, error helpers and fatal configuration', () => {
    shelljs.config.silent = true;
    expect(shelljs.cat(join(fixture(), 'missing')).code).toBe(1);
    expect(shelljs.errorCode()).toBe(1);
    expect(shelljs.error()).toContain('no such file');
    shelljs.config.fatal = true;
    expect(() => shelljs.cat(join(fixture(), 'missing'))).toThrow();
  });

  test('cmd passes spaces and shell metacharacters as literal arguments', () => {
    shelljs.config.silent = true;
    const result = shelljs.cmd(
      process.execPath,
      '-e',
      'process.stdout.write(process.argv.slice(1).join("|"))',
      'two words',
      '$HOME',
      '; echo injected',
      { silent: true }
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('two words|$HOME|; echo injected');
  });

  test('exports every documented ShellJS command, configuration and environment helper', () => {
    const commands = [
      'cat',
      'cd',
      'chmod',
      'cmd',
      'cp',
      'dirs',
      'echo',
      'exec',
      'find',
      'grep',
      'head',
      'ln',
      'ls',
      'mkdir',
      'mv',
      'popd',
      'pushd',
      'pwd',
      'rm',
      'sed',
      'set',
      'sort',
      'tail',
      'tempdir',
      'test',
      'touch',
      'uniq',
      'which',
      'exit',
      'error',
      'errorCode',
      'ShellString',
    ];
    for (const command of commands) {
      expect(typeof shelljs[command]).toBe('function');
    }
    expect(shelljs.env).toBe(process.env);
    expect(typeof shelljs.config.reset).toBe('function');
  });

  test('supports file writes, append and grep/sed without shell interpolation', () => {
    const directory = fixture();
    shelljs.config.silent = true;
    shelljs.ShellString('hello\n').to(join(directory, 'output'));
    shelljs.ShellString('world\n').toEnd(join(directory, 'output'));
    expect(readFileSync(join(directory, 'output'), 'utf8')).toBe(
      'hello\nworld\n'
    );
    expect(
      shelljs.grep('world', join(directory, 'output')).sed('world', 'friend')
        .stdout
    ).toBe('friend\n');
    expect(shelljs.test('-f', join(directory, 'output'))).toBe(true);
  });
});
