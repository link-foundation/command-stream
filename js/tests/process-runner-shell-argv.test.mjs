#!/usr/bin/env node

import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessRunner } from '../src/$.mjs';
import { isWindows } from './test-helper.mjs';

// TEMPORARY CI DIAGNOSTIC: capture the caller if the unrelated issue-170
// regression target is force-killed after these Windows shell-argv tests.
const originalKill = ProcessRunner.prototype.kill;
ProcessRunner.prototype.kill = function (...args) {
  if (this.spec?.command?.includes("echo 'stdout'")) {
    console.error(
      `[issue-191 diagnostic] ${JSON.stringify({
        spec: this.spec,
        awaited: this._awaited,
        started: this.started,
        finished: this.finished,
      })}\n${new Error('ProcessRunner.kill caller').stack}`
    );
  }
  return originalKill.apply(this, args);
};

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
  test('runs argv through the platform shell asynchronously', async () => {
    const runner = new ProcessRunner(shellArgvSpec(), {
      mirror: false,
      stdin: 'ignore',
    });

    const result = await runner;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
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
    expect(result.stdout).toBe(
      'ARG[--install-extension]\nARG[publisher.extension]\n'
    );
  });
});
