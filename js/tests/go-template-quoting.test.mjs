// Tests for Go/Docker template (`{{ }}`) argument handling and the diagnostic
// warning for unquoted template tokens that contain an internal space.
// See issue #172.

import { $ } from '../src/$.mjs';
import { buildShellCommand, findSplitTemplateToken } from '../src/$.quote.mjs';
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { fileURLToPath } from 'node:url';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup

// A tiny fixture that prints each argv on its own line, so we can assert
// exactly how a command is word-split into arguments. Interpolated as a safe
// path (single argument), while the template flags stay literal template text.
const PRINTER = fileURLToPath(
  new URL('./fixtures/argprint.mjs', import.meta.url)
);

function argsOf(stdout) {
  return stdout
    .split('\n')
    .filter((l) => l.startsWith('ARG['))
    .map((l) => l.slice(4, -1));
}

test('findSplitTemplateToken detects an unquoted template with a space', () => {
  expect(
    findSplitTemplateToken('docker inspect --format {{json .Config.Env}}')
  ).toBe('{{json .Config.Env}}');
});

test('findSplitTemplateToken ignores space-free templates', () => {
  expect(findSplitTemplateToken('docker inspect --format {{.Id}}')).toBeNull();
});

test('findSplitTemplateToken ignores single-quoted templates', () => {
  expect(
    findSplitTemplateToken("docker inspect --format '{{json .Config.Env}}'")
  ).toBeNull();
});

test('findSplitTemplateToken ignores double-quoted templates', () => {
  expect(
    findSplitTemplateToken('docker inspect --format "{{json .Config.Env}}"')
  ).toBeNull();
});

test('space-free template stays a single argument', async () => {
  const result = await $({ mirror: false })`node ${PRINTER} --format {{.Id}}`;
  expect(argsOf(result.stdout)).toEqual(['--format', '{{.Id}}']);
});

test('single-quoted template with a space stays a single argument', async () => {
  const result = await $({
    mirror: false,
  })`node ${PRINTER} --format '{{json .Config.Env}}'`;
  expect(argsOf(result.stdout)).toEqual(['--format', '{{json .Config.Env}}']);
});

test('double-quoted template with a space stays a single argument', async () => {
  const result = await $({
    mirror: false,
  })`node ${PRINTER} --format "{{json .Config.Env}}"`;
  expect(argsOf(result.stdout)).toEqual(['--format', '{{json .Config.Env}}']);
});

test('interpolated template with a space stays a single argument', async () => {
  const format = '{{json .Config.Env}}';
  const result = await $({
    mirror: false,
  })`node ${PRINTER} --format ${format}`;
  expect(argsOf(result.stdout)).toEqual(['--format', '{{json .Config.Env}}']);
});

test('unquoted template with a space is split (shell parity with bash)', async () => {
  const result = await $({
    mirror: false,
  })`node ${PRINTER} --format {{json .Config.Env}}`;
  // Exactly what `bash` does with the same unquoted token.
  expect(argsOf(result.stdout)).toEqual([
    '--format',
    '{{json',
    '.Config.Env}}',
  ]);
});

// Warning diagnostics -------------------------------------------------------

let warnings;
let originalError;
let originalEnv;

beforeEach(() => {
  warnings = [];
  originalError = console.error;
  console.error = (...args) => warnings.push(args.join(' '));
  originalEnv = process.env.COMMAND_STREAM_NO_TEMPLATE_WARNING;
  delete process.env.COMMAND_STREAM_NO_TEMPLATE_WARNING;
});

afterEach(() => {
  console.error = originalError;
  if (originalEnv === undefined) {
    delete process.env.COMMAND_STREAM_NO_TEMPLATE_WARNING;
  } else {
    process.env.COMMAND_STREAM_NO_TEMPLATE_WARNING = originalEnv;
  }
});

test('warns when an unquoted template token with a space is built', () => {
  // Use a unique token so the once-per-snippet dedup does not hide the warning.
  buildShellCommand(
    ['docker inspect --format {{json .Unique1.Env}} alpine'],
    []
  );
  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain('{{json .Unique1.Env}}');
  expect(warnings[0]).toContain('command-stream');
});

test('does not warn for space-free or quoted templates', () => {
  buildShellCommand(['docker inspect --format {{.Unique2}} alpine'], []);
  buildShellCommand(
    ["docker inspect --format '{{json .Unique3.Env}}' alpine"],
    []
  );
  expect(warnings.length).toBe(0);
});

test('warns only once per unique token', () => {
  buildShellCommand(['docker inspect --format {{json .Unique4.Env}}'], []);
  buildShellCommand(['docker inspect --format {{json .Unique4.Env}}'], []);
  expect(warnings.length).toBe(1);
});

test('COMMAND_STREAM_NO_TEMPLATE_WARNING silences the warning', () => {
  process.env.COMMAND_STREAM_NO_TEMPLATE_WARNING = '1';
  buildShellCommand(['docker inspect --format {{json .Unique5.Env}}'], []);
  expect(warnings.length).toBe(0);
});
