#!/usr/bin/env node

import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessRunner } from '../src/$.mjs';
import { buildCommandArgv, describeCommand } from '../src/$.shell.mjs';
import { isWindows } from './test-helper.mjs';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);
const argprint = path.join(fixturesDir, 'argprint.mjs');

function shellArgvSpec() {
  if (isWindows) {
    return {
      mode: 'shell',
      file: path.join(fixturesDir, 'argprint.cmd'),
      args: ['--install-extension', 'publisher.extension'],
    };
  }

  return {
    mode: 'shell',
    file: process.execPath,
    args: [argprint, '--install-extension', 'publisher.extension'],
  };
}

describe('ProcessRunner shell file/args mode', () => {
  test.skipIf(isWindows)(
    'exports invocation-local directory variables safely',
    () => {
      const argv = buildCommandArgv(
        { mode: 'shell', command: 'printf done' },
        { PWD: '/tmp/new dir', OLDPWD: "/tmp/old' dir" }
      );

      expect(argv.at(-1)).toBe(
        "export PWD='/tmp/new dir' OLDPWD='/tmp/old'\\'' dir'; printf done"
      );
    }
  );

  test('describes commands for xtrace without the invocation env', () => {
    expect(describeCommand({ mode: 'shell', command: 'printf done' })).toBe(
      'printf done'
    );
    expect(
      describeCommand({ mode: 'shell', file: 'code', args: ['--version'] })
    ).toBe('code --version');
    expect(describeCommand({ mode: 'shell', file: 'pwd' })).toBe('pwd');
    expect(
      describeCommand({ mode: 'exec', file: 'echo', args: ['a', 'b'] })
    ).toBe('echo a b');
  });

  test('runs argv through the platform shell asynchronously', async () => {
    const runner = new ProcessRunner(shellArgvSpec(), {
      mirror: false,
      stdin: 'ignore',
    });

    const result = await runner;

    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe(
      'ARG[--install-extension]\nARG[publisher.extension]\n'
    );
  });

  test('runs argv through the platform shell synchronously', () => {
    const runner = new ProcessRunner(shellArgvSpec(), {
      mirror: false,
      stdin: 'ignore',
    });

    const result = runner.sync();

    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe(
      'ARG[--install-extension]\nARG[publisher.extension]\n'
    );
  });
});
