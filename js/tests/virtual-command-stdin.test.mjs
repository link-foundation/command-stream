import { test, expect, describe, beforeEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, enableVirtualCommands, register, unregister } from '../src/$.mjs';
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
  // `bun test` evaluates test-helper.mjs only once, so its reset hooks belong to
  // whichever file imported it first. Another file may therefore leave virtual
  // commands disabled, which would send these commands to real binaries and
  // block on inherited stdin instead of exercising the code under test.
  beforeEach(() => {
    enableVirtualCommands();
  });

  test('a stdio mode keyword never becomes command input', async () => {
    // A dedicated command reports exactly what it was handed, so the assertion
    // does not depend on any system binary.
    register('stdin-probe', async ({ stdin }) => ({
      code: 0,
      stdout: JSON.stringify(stdin),
      stderr: '',
    }));
    try {
      const result = await $({
        mirror: false,
        stdin: 'inherit',
      })`stdin-probe`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('""');
    } finally {
      unregister('stdin-probe');
    }
  });

  test('a stdio mode keyword leaves a built-in command with no input', async () => {
    const result = await $({ mirror: false, stdin: 'inherit' })`cat`;
    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe('');
  });

  test('piped input reaches a virtual command', async () => {
    const result = await $({ mirror: false })`echo hello | cat`;
    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe('hello\n');
  });

  test('explicit stdin data reaches a virtual command', async () => {
    const result = await $({ mirror: false, stdin: 'from option\n' })`cat`;
    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe('from option\n');
  });

  test('a manual stdin pipe belongs to the public runner', async () => {
    // Use a portable real executable with a virtual name to reproduce the
    // same fallback as head/tail/sort/uniq without depending on Unix tools.
    register('node', async () => {
      throw new Error('manual stdin must use the real executable');
    });
    const script = 'process.stdin.pipe(process.stdout)';
    const runner = $({ mirror: false })`node -e ${script}`;
    let deadline;
    try {
      const stdin = await Promise.race([
        runner.streams.stdin,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('manual stdin never became available')),
            2000
          );
        }),
      ]);
      expect(stdin).not.toBe(null);
      expect(runner.child.stdin).toBe(stdin);
      expect(await runner.streams.stdout).toBe(runner.child.stdout);
      expect(await runner.streams.stderr).toBe(runner.child.stderr);
      expect(runner.pid).toBeGreaterThan(0);
      stdin.end('manual input\n');
      const result = await runner;
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toBe('manual input\n');
      expect(result.stdin.toString()).toBe('manual input\n');
    } finally {
      clearTimeout(deadline);
      runner.kill();
      unregister('node');
    }
  });

  test('piped input wins over the pipeline stdin option', async () => {
    const result = await $({
      mirror: false,
      stdin: 'from option\n',
    })`echo piped | cat`;
    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe('piped\n');
  });

  test('tee receives piped input, not the stdio mode keyword', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-tee-stdin-'));
    try {
      const file = join(dir, 'out.txt');
      const result = await $({ mirror: false })`echo streamed | tee ${file}`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('streamed\n');
      expect(readFileSync(file, 'utf8')).toBe('streamed\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
