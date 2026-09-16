// Regression tests for behaviours that used to differ between Node.js and Bun,
// or that silently diverged from the documented API.
//
// Every expectation here is runtime-independent on purpose: the whole point of
// these tests is that `bun test` and the Node parity runner
// (`node scripts/check-parity.mjs`) must observe the very same values.
import { describe, test, expect, afterEach } from 'bun:test';
import './test-helper.mjs';
import { $, register, unregister } from '../src/$.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const $q = $({ mirror: false, capture: true });

const tempDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-parity-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('result.text() is available on every execution path', () => {
  test('system command (async)', async () => {
    const result = await $q`sh -c 'echo system'`;
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('system\n');
  });

  test('built-in command (async)', async () => {
    const result = await $q`echo builtin`;
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('builtin\n');
  });

  test('built-in command (sync)', async () => {
    const result = $({ mirror: false })`echo builtin`.sync();
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('builtin\n');
  });

  test('pipeline', async () => {
    const result = await $q`echo a | cat`;
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('a\n');
  });

  test('.pipe() method', async () => {
    const result = await $({ mirror: false })`echo a`.pipe($({ mirror: false })`cat`);
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('a\n');
  });

  test('virtual command', async () => {
    register('parity-text', async () => ({ stdout: 'virtual\n', code: 0 }));
    try {
      const result = await $q`parity-text`;
      expect(typeof result.text).toBe('function');
      expect(await result.text()).toBe('virtual\n');
    } finally {
      unregister('parity-text');
    }
  });
});

describe('virtual command stdin', () => {
  test('a standalone virtual command receives empty stdin, never the "inherit" sentinel', async () => {
    register('parity-stdin', async ({ stdin }) => ({ stdout: JSON.stringify(stdin), code: 0 }));
    try {
      const result = await $q`parity-stdin`;
      expect(result.stdout).toBe('""');
    } finally {
      unregister('parity-stdin');
    }
  });

  test('a virtual command receives the previous built-in command output', async () => {
    register('parity-upper', async ({ stdin }) => ({ stdout: String(stdin).toUpperCase(), code: 0 }));
    try {
      expect((await $q`echo abc | parity-upper`).stdout).toBe('ABC\n');
    } finally {
      unregister('parity-upper');
    }
  });

  test('a virtual command receives the previous system command output', async () => {
    register('parity-upper', async ({ stdin }) => ({ stdout: String(stdin).toUpperCase(), code: 0 }));
    try {
      expect((await $q`sh -c 'echo sys' | parity-upper`).stdout).toBe('SYS\n');
    } finally {
      unregister('parity-upper');
    }
  });

  test('explicit stdin is forwarded to a virtual command', async () => {
    register('parity-upper', async ({ stdin }) => ({ stdout: String(stdin).toUpperCase(), code: 0 }));
    try {
      const result = await $({ mirror: false, capture: true, stdin: 'given\n' })`parity-upper`;
      expect(result.stdout).toBe('GIVEN\n');
    } finally {
      unregister('parity-upper');
    }
  });

  test('the handler context exposes the documented fields', async () => {
    let seen;
    register('parity-ctx', async (ctx) => {
      seen = ctx;
      return { stdout: '', code: 0 };
    });
    try {
      await $({ mirror: false, capture: true, cwd: os.tmpdir() })`parity-ctx one two`;
      expect(seen.args).toEqual(['one', 'two']);
      expect(seen.stdin).toBe('');
      expect(seen.cwd).toBe(os.tmpdir());
      expect(typeof seen.isCancelled).toBe('function');
      expect(seen.options).toBeDefined();
      expect(seen.env).toBeDefined();
    } finally {
      unregister('parity-ctx');
    }
  });
});

describe('pipeline exit codes', () => {
  test('the exit code of the last virtual command is propagated', async () => {
    register('parity-fail', async () => ({ stdout: '', stderr: 'boom\n', code: 7 }));
    try {
      const result = await $q`echo a | parity-fail`;
      expect(result.code).toBe(7);
      expect(result.stderr).toContain('boom');
    } finally {
      unregister('parity-fail');
    }
  });

  test('the exit code of the last system command is propagated', async () => {
    const result = await $q`echo a | sh -c 'exit 7'`;
    expect(result.code).toBe(7);
  });

  test('a failing built-in command in the last position is propagated', async () => {
    const result = await $q`echo a | cat /definitely/not/here`;
    expect(result.code).not.toBe(0);
  });

  test('a failure in an earlier stage does not mask the final exit code', async () => {
    register('parity-fail', async () => ({ stdout: '', stderr: 'boom\n', code: 7 }));
    try {
      const result = await $q`parity-fail | cat`;
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('boom');
    } finally {
      unregister('parity-fail');
    }
  });
});

describe('output redirection with built-in and virtual commands', () => {
  test('`command > file` writes the file instead of passing ">" as an argument', async () => {
    const file = path.join(tempDir(), 'out.txt');
    const result = await $q`echo hello > ${file}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe('hello\n');
  });

  test('`command >> file` appends', async () => {
    const file = path.join(tempDir(), 'out.txt');
    await $q`echo one > ${file}`;
    await $q`echo two >> ${file}`;
    expect(fs.readFileSync(file, 'utf8')).toBe('one\ntwo\n');
  });

  test('redirection at the end of a pipeline writes the file', async () => {
    const file = path.join(tempDir(), 'numbers.txt');
    const result = await $q`seq 1 3 | cat > ${file}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe('1\n2\n3\n');
  });

  test('a quoted ">" stays a literal argument', async () => {
    const result = await $q`echo "a > b"`;
    expect(result.stdout).toBe('a > b\n');
  });

  test('input redirection feeds a built-in command', async () => {
    const file = path.join(tempDir(), 'in.txt');
    fs.writeFileSync(file, 'from-file\n');
    const result = await $q`cat < ${file}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('from-file\n');
  });
});
