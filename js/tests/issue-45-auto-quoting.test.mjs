// Automatic quoting semantics (issue #45).
//
// Interpolated values are data, not pre-escaped shell fragments. This matches
// `"$V"` in sh and the template APIs in Bun, zx, and execa. Authors can put an
// interpolation inside template quotes without receiving a second quote layer,
// while the legacy pre-quoted passthrough remains available as an explicit
// compatibility option.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, afterEach } from 'bun:test';
import { $, setPreQuotedPassthroughEnabled } from '../src/$.mjs';
import { buildShellCommand } from '../src/$.quote.mjs';
import './test-helper.mjs';

const PRINTER = fileURLToPath(
  new URL('./fixtures/argprint.mjs', import.meta.url)
);
const isWindows = process.platform === 'win32';

function argsOf(stdout) {
  return [...stdout.matchAll(/^ARG\[([\s\S]*?)\]$/gm)].map((match) => match[1]);
}

afterEach(() => {
  setPreQuotedPassthroughEnabled(null);
});

test('pre-quoted input is one literal argument by default', async () => {
  const arg = '"already quoted"';
  const command = $({ mirror: false })`node ${PRINTER} ${arg}`;

  expect(buildShellCommand(['echo ', ''], [arg])).toBe(
    'echo \'"already quoted"\''
  );
  expect(argsOf((await command).stdout)).toEqual([arg]);
});

test.skipIf(isWindows)('pre-quoted input matches "$V" in /bin/sh', async () => {
  const values = [
    '"already quoted"',
    "'already quoted'",
    '"it\'s still one argument"',
    '"$HOME; echo not-executed"',
  ];

  for (const value of values) {
    const reference = spawnSync(
      '/bin/sh',
      ['-c', 'node "$1" "$V"', 'issue-45', PRINTER],
      {
        env: { ...process.env, V: value },
        encoding: 'utf8',
      }
    );
    const result = await $({ mirror: false })`node ${PRINTER} ${value}`;

    expect(result.code).toBe(reference.status);
    expect(result.stdout).toBe(reference.stdout);
    expect(argsOf(result.stdout)).toEqual([value]);
  }
});

test('pre-quoted input matches Bun shell interpolation', async () => {
  const values = [
    '"already quoted"',
    "'already quoted'",
    '"it\'s still one argument"',
    '"$HOME; echo not-executed"',
  ];

  for (const value of values) {
    const commandStream = await $({ mirror: false })`node ${PRINTER} ${value}`;
    const bun = await Bun.$`node ${PRINTER} ${value}`.quiet();

    expect(argsOf(commandStream.stdout)).toEqual([value]);
    expect(argsOf(bun.stdout.toString())).toEqual([value]);
  }
});

test('author-written quotes do not add a redundant quote layer', async () => {
  const arg = 'already quoted';
  const command = $({ mirror: false })`node ${PRINTER} "${arg}"`;

  expect(buildShellCommand(['echo "', '"'], [arg])).toBe(
    'echo "already quoted"'
  );
  expect(argsOf((await command).stdout)).toEqual([arg]);
});

test('author-written quotes keep metacharacters literal', async () => {
  const arg = 'costs $5; "yes" `not-run` \\end';
  const result = await $({ mirror: false })`node ${PRINTER} "${arg}"`;

  expect(argsOf(result.stdout)).toEqual([arg]);
});

test('legacy passthrough is an explicit compatibility option', async () => {
  const arg = '"already quoted"';
  setPreQuotedPassthroughEnabled(true);

  const command = $({ mirror: false })`node ${PRINTER} ${arg}`;
  expect(buildShellCommand(['echo ', ''], [arg])).toBe('echo "already quoted"');
  expect(argsOf((await command).stdout)).toEqual(['already quoted']);
});

test('legacy passthrough still rejects unbalanced quoted input', async () => {
  const arg = '"quoted"; echo not-executed; "value"';
  setPreQuotedPassthroughEnabled(true);

  const result = await $({ mirror: false })`node ${PRINTER} ${arg}`;
  expect(argsOf(result.stdout)).toEqual([arg]);
  expect(result.stdout).not.toContain('\nnot-executed\n');
});
