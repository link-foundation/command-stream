// The Bun.$-compatible entry points: `command-stream/bun` (ESM and CommonJS)
// and `$.bun`. Shell semantics are covered by the conformance corpus
// (conformance/bun-shell, run by .github/workflows/bun-shell.yml); these tests
// pin down the public surface.

import { test, expect, describe } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ as root } from '../src/$.mjs';
import bunDefault, {
  $,
  Shell,
  ShellError,
  ShellFile,
  ShellOutput,
  ShellPromise,
} from '../src/bun.mjs';

const require = createRequire(import.meta.url);

describe('entry points', () => {
  test('the subpath, $.bun and CommonJS share one $', async () => {
    const viaPackage = await import('command-stream/bun');
    expect(viaPackage.$).toBe($);
    expect(bunDefault).toBe($);
    expect(root.bun).toBe($);
    const cjs = require('../src/bun.cjs');
    expect(cjs.$).toBe($);
    expect(cjs.default).toBe($);
    expect(cjs.ShellError).toBe(ShellError);
    expect(require('../src/$.cjs').bun).toBe($);
  });

  test('$ carries Bun static helpers', () => {
    expect($.Shell).toBe(Shell);
    expect($.ShellPromise).toBe(ShellPromise);
    expect($.ShellError).toBe(ShellError);
    expect($.escape('a b')).toBe('"a b"');
    expect($.braces('x{1,2}')).toEqual(['x1', 'x2']);
    expect($.file('a.txt')).toBeInstanceOf(ShellFile);
  });
});

describe('ShellPromise', () => {
  test('text(), json() and lines()', async () => {
    expect(await $`echo ${'hello world'} | cat`.text()).toBe('hello world\n');
    expect(await $`echo '{"a":1}'`.json()).toEqual({ a: 1 });
    const lines = [];
    for await (const line of $`echo a; echo b`.lines()) {
      lines.push(line);
    }
    expect(lines).toEqual(['a', 'b', '']);
  });

  test('resolves to a ShellOutput', async () => {
    const out = await $`echo out; echo err 1>&2`.quiet();
    expect(out).toBeInstanceOf(ShellOutput);
    expect(out.stdout.toString()).toBe('out\n');
    expect(out.stderr.toString()).toBe('err\n');
    expect(out.exitCode).toBe(0);
  });

  test('rejects with ShellError on a non-zero exit, unless nothrow()', async () => {
    const error = await $`echo nope; exit 3`.quiet().catch((e) => e);
    expect(error).toBeInstanceOf(ShellError);
    expect(error.message).toBe('Failed with exit code 3');
    expect(error.exitCode).toBe(3);
    expect(error.text()).toBe('nope\n');
    const out = await $`exit 3`.nothrow().quiet();
    expect(out.exitCode).toBe(3);
  });

  test('is lazy and parses eagerly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bun-shell-api-'));
    try {
      const pending = $`echo x > out.txt`.cwd(dir);
      await Bun.sleep(20);
      expect(() => readFileSync(join(dir, 'out.txt'))).toThrow();
      await pending;
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('x\n');
      expect(() => $`echo (`).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('interpolates arrays, raw strings and buffers', async () => {
    const buf = new Uint8Array(4);
    await $`echo ${['a', 'b c']} ${{ raw: '| cat' }}`
      .quiet()
      .then((o) => expect(o.text()).toBe('a b c\n'));
    await $`echo hi > ${buf}`;
    expect(Buffer.from(buf).toString()).toBe('hi\n\0');
    const input = Buffer.from('from buffer');
    expect(await $`cat < ${input}`.text()).toBe('from buffer');
  });
});

describe('new $.Shell()', () => {
  test('has its own env, cwd and throwing mode', async () => {
    const sh = new $.Shell();
    sh.env({ ...process.env, GREETING: 'hi' }).nothrow();
    expect(await sh`echo $GREETING`.text()).toBe('hi\n');
    expect((await sh`exit 2`.quiet()).exitCode).toBe(2);
    expect(await $`echo $GREETING`.text()).toBe('\n');
    expect(() => Shell()).toThrow(TypeError);
  });
});
