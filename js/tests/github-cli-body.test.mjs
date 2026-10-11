// GitHub CLI complex Markdown regression coverage (issue #40).
//
// A body interpolated into a command is one literal argv value. This file uses
// node:test so the same regression runs under Bun and every supported Node.js
// version in CI.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, test } from 'node:test';
import { COMPLEX_MARKDOWN_BODY } from './fixtures/complex-markdown-body.mjs';

const moduleUrl = process.env.COMMAND_STREAM_TEST_MODULE
  ? pathToFileURL(process.env.COMMAND_STREAM_TEST_MODULE).href
  : new URL('../src/$.mjs', import.meta.url).href;
const commandStream = await import(moduleUrl);
const { $ } = commandStream;
const resetQuoteContext = commandStream.setQuoteContextEnabled ?? (() => {});

const ARGV_PRINTER = fileURLToPath(
  new URL('./fixtures/argv-json.mjs', import.meta.url)
);
const TITLE = 'Complex "Markdown" issue';

const expectedArgs = [
  'issue',
  'create',
  '--repo',
  'owner/repo',
  '--title',
  TITLE,
  '--body',
  COMPLEX_MARKDOWN_BODY,
];

afterEach(() => resetQuoteContext(null));

async function receivedArgs(command) {
  const result = await command;
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('unquoted --body interpolation preserves complex Markdown exactly', async () => {
  const actual = await receivedArgs(
    $({
      mirror: false,
    })`${process.execPath} ${ARGV_PRINTER} issue create --repo owner/repo --title ${TITLE} --body ${COMPLEX_MARKDOWN_BODY}`
  );

  assert.deepEqual(actual, expectedArgs);
});

test('unquoted --body preserves a backslash immediately before a newline', async () => {
  const body = 'path ending in a backslash\\\nnext line';
  const actual = await receivedArgs(
    $({
      mirror: false,
    })`${process.execPath} ${ARGV_PRINTER} --body ${body}`
  );

  assert.deepEqual(actual, ['--body', body]);
});

test('double-quoted --body interpolation preserves complex Markdown exactly', async () => {
  const actual = await receivedArgs(
    $({
      mirror: false,
    })`${process.execPath} ${ARGV_PRINTER} issue create --repo owner/repo --title "${TITLE}" --body "${COMPLEX_MARKDOWN_BODY}"`
  );

  assert.deepEqual(actual, expectedArgs);
});

test('single-quoted --body interpolation preserves complex Markdown exactly', async () => {
  const actual = await receivedArgs(
    $({
      mirror: false,
    })`${process.execPath} ${ARGV_PRINTER} issue create --repo owner/repo --title '${TITLE}' --body '${COMPLEX_MARKDOWN_BODY}'`
  );

  assert.deepEqual(actual, expectedArgs);
});

test(
  'shell syntax in a quoted body remains data',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'issue-40-body-'));
    const marker = path.join(directory, 'injected');
    const body = `safe\n"; touch ${marker}; #\n$(touch ${marker})\n\`touch ${marker}\``;

    try {
      const actual = await receivedArgs(
        $({
          mirror: false,
        })`${process.execPath} ${ARGV_PRINTER} --body "${body}"`
      );
      assert.deepEqual(actual, ['--body', body]);
      assert.equal(existsSync(marker), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test('legacy quote mode remains usable with shell-style unquoted interpolation', async () => {
  resetQuoteContext(false);

  const actual = await receivedArgs(
    $({
      mirror: false,
    })`${process.execPath} ${ARGV_PRINTER} --body ${COMPLEX_MARKDOWN_BODY}`
  );
  assert.deepEqual(actual, ['--body', COMPLEX_MARKDOWN_BODY]);
});
