import { test, expect } from 'bun:test';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crossSpawn from 'cross-spawn';
import $, { spawn } from '../src/$.mjs';

test('spawn exports the same ChildProcess API from named and default entries', async () => {
  expect($.spawn).toBe(spawn);
  expect(spawn).toBe(crossSpawn);
  expect(typeof spawn.sync).toBe('function');

  const child = spawn(process.execPath, [
    '-e',
    'process.stdout.write(process.argv[1])',
    'a b;$(x)',
  ]);
  expect(typeof child.pid).toBe('number');
  expect(typeof child.kill).toBe('function');
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  const [code, signal] = await once(child, 'close');
  expect([code, signal]).toEqual([0, null]);
  expect(Buffer.concat(chunks).toString()).toBe('a b;$(x)');
});

test('spawn accepts cwd, env, and piped stdin without losing streaming output', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'command-stream-spawn-'));
  try {
    const script =
      'process.stdin.on("data", chunk => process.stdout.write(process.cwd() + ":" + process.env.SPAWN_TEST + ":" + chunk))';
    const child = $.spawn(process.execPath, ['-e', script], {
      cwd,
      env: { ...process.env, SPAWN_TEST: 'value' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stdin.end('input');
    const [code] = await once(child, 'close');
    expect(code).toBe(0);
    const output = Buffer.concat(chunks).toString();
    expect(output.endsWith(':value:input')).toBe(true);
    const reportedCwd = output.slice(0, -':value:input'.length);
    expect(realpathSync(reportedCwd)).toBe(realpathSync(cwd));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('spawn preserves native failure and synchronous result semantics', async () => {
  const nonzero = $.spawn.sync(process.execPath, ['-e', 'process.exit(7)']);
  expect(nonzero.status).toBe(7);
  expect(nonzero.error).toBeFalsy();
  expect(Buffer.isBuffer(nonzero.stdout)).toBe(true);

  const missing = $.spawn.sync('command-stream-command-does-not-exist');
  expect(missing.status).not.toBe(0);
  if (process.platform !== 'win32') {
    expect(missing.error?.code).toBe('ENOENT');

    const child = $.spawn('command-stream-command-does-not-exist');
    const [error] = await once(child, 'error');
    expect(error.code).toBe('ENOENT');
  }
});
