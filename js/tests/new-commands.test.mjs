import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, listCommands, ProcessRunner } from '../src/$.mjs';
import head from '../src/commands/$.head.mjs';
import tail from '../src/commands/$.tail.mjs';
import sort from '../src/commands/$.sort.mjs';
import uniq from '../src/commands/$.uniq.mjs';
import cases from '../../conformance/text-commands/cases.json';

const handlers = { head, tail, sort, uniq };
const directory = mkdtempSync(join(tmpdir(), 'command-stream-text-'));
writeFileSync(join(directory, 'first file'), 'a\na\nb');
writeFileSync(join(directory, '-file'), 'z\na\n');
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function invoke(command, args, stdin = '', extra = {}) {
  try {
    const output = handlers[command]({ args, stdin, cwd: directory, ...extra });
    if (output[Symbol.asyncIterator]) {
      let stdout = '';
      for await (const chunk of output) {
        stdout += chunk;
      }
      return { code: 0, stdout, stderr: '' };
    }
    return await output;
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.message,
    };
  }
}

describe('native text command conformance (shared with Rust)', () => {
  test.each(cases.map((entry, index) => [index, entry]))(
    'case %i: %j',
    async (_index, entry) => {
      const result = await invoke(entry.command, entry.args, entry.stdin);
      expect(result.code).toBe(entry.error ? 1 : 0);
      if (!entry.error) {
        expect(result.stdout).toBe(entry.stdout);
      } else {
        expect(result.stderr.length).toBeGreaterThan(0);
      }
    }
  );

  test.each(Object.keys(handlers))(
    '%s reads relative paths with spaces',
    async (name) => {
      const result = await invoke(name, ['first file']);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        name === 'uniq' ? 'a\nb' : name === 'sort' ? 'a\na\nb\n' : 'a\na\nb'
      );
    }
  );

  test.each(Object.keys(handlers))(
    '%s returns errors for missing files and directories',
    async (name) => {
      for (const file of ['missing', '.']) {
        const result = await invoke(name, [file]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(
          file === 'missing' ? 'No such file' : 'directory'
        );
      }
    }
  );

  test.each(Object.keys(handlers))(
    '%s honors cancellation for stdin too',
    async (name) => {
      const result = await invoke(name, [], 'a\n', { isCancelled: () => true });
      expect(result.code).toBe(130);
    }
  );

  test.each(Object.keys(handlers))(
    '%s supports -- before dash-prefixed paths',
    async (name) => {
      const result = await invoke(name, ['--', '-file']);
      expect(result.code).toBe(0);
    }
  );

  test('tail and head label multiple files and preserve unterminated lines', async () => {
    for (const name of ['head', 'tail']) {
      const result = await invoke(name, ['-n', '1', 'first file', '-']);
      expect(result.stdout).toBe(
        `==> first file <==\n${name === 'head' ? 'a\n' : 'b'}\n==> standard input <==\n`
      );
    }
  });

  test('uniq supports an output file', async () => {
    const result = await invoke('uniq', ['first file', 'output']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(await Bun.file(join(directory, 'output')).text()).toBe('a\nb');
  });

  test('head -n 0 does not consume stdin but still validates file operands', async () => {
    const context = {
      args: ['-n', '0'],
      get stdin() {
        throw new Error('stdin must not be consumed');
      },
    };
    expect((await head(context).next()).done).toBe(true);
    for (const file of ['missing', '.']) {
      expect((await invoke('head', ['-n', '0', file])).code).toBe(1);
    }
  });

  test('head and uniq yield file output incrementally and observe cancellation', async () => {
    for (const name of ['head', 'uniq']) {
      let cancelled = false;
      const iterator = handlers[name]({
        args: ['first file'],
        cwd: directory,
        isCancelled: () => cancelled,
      });
      expect((await iterator.next()).value).toBe('a\n');
      cancelled = true;
      await expect(iterator.next()).rejects.toMatchObject({ code: 130 });
    }
  });

  test('all 26 native builtins are registered', () => {
    expect(listCommands().length).toBeGreaterThanOrEqual(26);
    for (const name of Object.keys(handlers)) {
      expect(listCommands()).toContain(name);
    }
  });

  test('commands integrate with the native runner and mixed pipelines', async () => {
    const command = $({
      cwd: directory,
      mirror: false,
    })`head -n 2 ${'first file'}`;
    expect((await command).stdout.toString()).toBe('a\na\n');
    const result = await $({
      cwd: directory,
      mirror: false,
    })`sort ${'first file'} | uniq -c`;
    expect(result.stdout.toString()).toBe('      2 a\n      1 b\n');
    const runner = new ProcessRunner(
      { mode: 'shell', command: 'tail -n 0' },
      { stdin: 'a\nb\n', mirror: false }
    );
    expect((await runner.start()).stdout.toString()).toBe('');
  });
});
