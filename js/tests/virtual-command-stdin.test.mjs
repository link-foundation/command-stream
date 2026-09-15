import { test, expect, describe } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';
import { stdinDataFromOptions } from '../src/$.stream-utils.mjs';

// Regression coverage for issue #14: the `stdin` option carries either input
// data or one of the stdio mode keywords. Virtual commands used to receive the
// keyword itself as their input, so `echo hello | cat` resolved to "inherit".

describe('stdinDataFromOptions', () => {
  test('treats stdio mode keywords as "no input"', () => {
    expect(stdinDataFromOptions({ stdin: 'inherit' })).toBe('');
    expect(stdinDataFromOptions({ stdin: 'ignore' })).toBe('');
    expect(stdinDataFromOptions({ stdin: 'pipe' })).toBe('');
  });

  test('passes through real input data', () => {
    expect(stdinDataFromOptions({ stdin: 'hello\n' })).toBe('hello\n');
    expect(stdinDataFromOptions({ stdin: Buffer.from('buffered') })).toBe(
      'buffered'
    );
  });

  test('defaults to an empty string', () => {
    expect(stdinDataFromOptions()).toBe('');
    expect(stdinDataFromOptions({})).toBe('');
    expect(stdinDataFromOptions({ stdin: undefined })).toBe('');
  });
});

describe('virtual commands and the stdin option', () => {
  test('a stdio mode keyword never becomes command input', async () => {
    const result = await $({ mirror: false, stdin: 'inherit' })`cat`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  test('piped input reaches a virtual command', async () => {
    const result = await $({ mirror: false })`echo hello | cat`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello\n');
  });

  test('explicit stdin data reaches a virtual command', async () => {
    const result = await $({ mirror: false, stdin: 'from option\n' })`cat`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('from option\n');
  });

  test('piped input wins over the pipeline stdin option', async () => {
    const result = await $({
      mirror: false,
      stdin: 'from option\n',
    })`echo piped | cat`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('piped\n');
  });

  test('tee receives piped input, not the stdio mode keyword', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-tee-stdin-'));
    try {
      const file = join(dir, 'out.txt');
      const result = await $({ mirror: false })`echo streamed | tee ${file}`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('streamed\n');
      expect(readFileSync(file, 'utf8')).toBe('streamed\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
