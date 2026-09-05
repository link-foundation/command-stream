#!/usr/bin/env node

// Regression tests for issue #48:
// "GitHub search queries with labels containing spaces fail due to multiple
//  layers of escaping issues when passed through command-stream."
//
// The canonical repro is:
//   const label = 'help wanted';
//   await $`gh issue list --label "${label}"`;
// The label must arrive at the command as a single argument `help wanted`
// (quotes removed), matching how POSIX `sh` performs quote removal.

import { test, expect, describe, beforeEach } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  $,
  shell,
  enableVirtualCommands,
  register,
  unregister,
} from '../src/$.mjs';
import { removeShellQuotes } from '../src/shell-parser.mjs';
import { isWindows } from './test-helper.mjs';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);
const argprint = path.join(fixturesDir, 'argprint.mjs');

function setup() {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  enableVirtualCommands();
}

describe('removeShellQuotes (POSIX quote removal)', () => {
  test('removes quotes wrapping a whole word', () => {
    expect(removeShellQuotes("'help wanted'").value).toBe('help wanted');
    expect(removeShellQuotes('"help wanted"').value).toBe('help wanted');
  });

  test('removes quotes embedded mid-word and concatenates', () => {
    expect(removeShellQuotes("label:'help wanted'").value).toBe(
      'label:help wanted'
    );
    expect(removeShellQuotes('label:"help wanted"').value).toBe(
      'label:help wanted'
    );
    expect(removeShellQuotes("--label='help wanted'").value).toBe(
      '--label=help wanted'
    );
    expect(removeShellQuotes("a'b c'd").value).toBe('ab cd');
  });

  test('handles the POSIX single-quote escape idiom', () => {
    expect(removeShellQuotes("'it'\\''s here'").value).toBe("it's here");
  });

  test('handles backslash escapes', () => {
    expect(removeShellQuotes('a\\ b').value).toBe('a b');
    expect(removeShellQuotes('"a\\"b"').value).toBe('a"b');
    expect(removeShellQuotes('"a\\nb"').value).toBe('a\\nb');
  });

  test('reports quoting flags', () => {
    const q = removeShellQuotes("'x'");
    expect(q.value).toBe('x');
    expect(q.quoted).toBe(true);
    expect(q.quoteChar).toBe("'");

    const plain = removeShellQuotes('plain');
    expect(plain.value).toBe('plain');
    expect(plain.quoted).toBe(false);
    expect(plain.quoteChar).toBe(null);
  });
});

describe('GitHub search escaping (issue #48)', () => {
  beforeEach(() => {
    setup();
  });

  test('virtual echo receives a spaced label as one quote-removed argument', async () => {
    const label = 'help wanted';
    const result = await $({ mirror: false })`echo label:"${label}"`;
    expect(result.stdout.trimEnd()).toBe('label:help wanted');
  });

  test('virtual echo handles the exact issue shape (--label "value")', async () => {
    const label = 'help wanted';
    const result = await $({ mirror: false })`echo --label "${label}"`;
    expect(result.stdout.trimEnd()).toBe('--label help wanted');
  });

  test.skipIf(isWindows)(
    'spawned process receives the spaced label as a single argv entry',
    async () => {
      const label = 'help wanted';
      const result = await $({
        mirror: false,
      })`${process.execPath} ${argprint} --label "${label}"`;
      expect(result.stdout).toBe('ARG[--label]\nARG[help wanted]\n');
    }
  );

  test.skipIf(isWindows)(
    'label containing a single quote survives round-trip',
    async () => {
      const label = "it's complicated";
      const result = await $({
        mirror: false,
      })`${process.execPath} ${argprint} --label "${label}"`;
      expect(result.stdout).toBe("ARG[--label]\nARG[it's complicated]\n");
    }
  );

  test.skipIf(isWindows)(
    'matches /bin/sh word-splitting for a spaced, embedded label',
    async () => {
      const label = 'help wanted';
      const csResult = await $({
        mirror: false,
      })`${process.execPath} ${argprint} label:"${label}"`;

      const shOut = execFileSync(
        '/bin/sh',
        ['-c', `${process.execPath} ${argprint} label:"${label}"`],
        { encoding: 'utf8' }
      );

      expect(csResult.stdout).toBe(shOut);
      expect(csResult.stdout).toBe('ARG[label:help wanted]\n');
    }
  );
});

describe('custom virtual command receives quote-removed args (issue #48)', () => {
  beforeEach(() => {
    setup();
  });

  test('space-containing argument arrives as a single value', async () => {
    const received = [];
    register('capture48', async ({ args }) => {
      received.push(...args);
      return { stdout: '', stderr: '', code: 0 };
    });
    try {
      const label = 'help wanted';
      await $({ mirror: false })`capture48 --label "${label}"`;
      expect(received).toEqual(['--label', 'help wanted']);
    } finally {
      unregister('capture48');
    }
  });
});
