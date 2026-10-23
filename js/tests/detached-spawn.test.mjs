// Issue #232: fire-and-forget commands. `spawnDetached()`, `$({ detached })`
// and `runner.spawnDetached()` resolve with the pid as soon as the process has
// spawned, honour `cwd` and `env`, and leave the child running in a session
// of its own after the caller exits.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { $, ProcessRunner, spawnDetached } from '../src/$.mjs';
import { activeProcessRunners } from '../src/$.state.mjs';
import { isWindows } from './test-helper.mjs';

const node = process.execPath;
const report =
  "require('fs').writeFileSync('out', [process.pid, process.cwd(), process.env.DETACH_VALUE ?? 'unset'].join('|') + '\\n')";

function tempDir() {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'command-stream-detach-'))
  );
}

async function waitForFile(file) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.endsWith('\n')) {
        return text;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${file} was never written`);
}

describe('spawnDetached()', () => {
  test('resolves with the pid and honours cwd and env', async () => {
    const dir = tempDir();
    const result = await spawnDetached([node, '-e', report], {
      cwd: dir,
      env: { ...process.env, DETACH_VALUE: 'set' },
    });
    expect(Object.keys(result)).toEqual(['pid']);
    expect(Number.isInteger(result.pid)).toBe(true);

    const text = await waitForFile(path.join(dir, 'out'));
    expect(text).toBe(`${result.pid}|${dir}|set\n`);
  });

  test('accepts { file, args } and command strings', async () => {
    const dir = tempDir();
    await spawnDetached({ file: node, args: ['-e', report] }, { cwd: dir });
    expect(await waitForFile(path.join(dir, 'out'))).toEndWith('|unset\n');

    const { pid } = await spawnDetached('echo from-shell > shell-out', {
      cwd: dir,
    });
    expect(pid).toBeGreaterThan(0);
    expect(await waitForFile(path.join(dir, 'shell-out'))).toMatch(
      /^from-shell\s*\n$/
    );
  });

  test('rejects when the program cannot be started', async () => {
    await expect(
      spawnDetached(['command-stream-no-such-program'])
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(spawnDetached({ args: [] })).rejects.toThrow(TypeError);
  });

  test.skipIf(isWindows)('the child leads a new session', async () => {
    const { pid } = await spawnDetached(['sleep', '5']);
    try {
      const [group, session] = execFileSync('ps', [
        '-o',
        'pgid=,sid=',
        '-p',
        String(pid),
      ])
        .toString()
        .trim()
        .split(/\s+/)
        .map(Number);
      expect(group).toBe(pid);
      expect(session).toBe(pid);
    } finally {
      process.kill(pid, 'SIGKILL');
    }
  });

  test('the child outlives the caller', async () => {
    const dir = tempDir();
    const started = Date.now();
    const output = execFileSync(
      node,
      [path.join(import.meta.dir, 'fixtures', 'detached-probe.mjs'), dir],
      { timeout: 10000 }
    ).toString();
    expect(Number(output.trim())).toBeGreaterThan(0);
    // The caller returned without waiting for the 500 ms delayed write.
    if (Date.now() - started < 450) {
      expect(fs.existsSync(path.join(dir, 'alive'))).toBe(false);
    }
    expect(await waitForFile(path.join(dir, 'alive'))).toBe('alive\n');
  });
});

describe('$({ detached: true })', () => {
  test('resolves without waiting for the command to exit', async () => {
    const dir = tempDir();
    const started = Date.now();
    const result = await $({
      cwd: dir,
      detached: true,
    })`sleep 1; echo done > done`;
    expect(Date.now() - started).toBeLessThan(900);
    expect(result).toMatchObject({ code: 0, detached: true });
    expect(result.pid).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir, 'done'))).toBe(false);
    expect(await waitForFile(path.join(dir, 'done'))).toMatch(/^done\s*\n$/);
  });

  test('.sync() returns the pid too', async () => {
    const dir = tempDir();
    const result = $({ cwd: dir, detached: true })`echo sync > out`.sync();
    expect(result).toMatchObject({ code: 0, detached: true });
    expect(result.pid).toBeGreaterThan(0);
    expect(await waitForFile(path.join(dir, 'out'))).toMatch(/^sync\s*\n$/);
  });

  test('the runner is finished and released, the child is not', async () => {
    const runner = $({ detached: true })`sleep 5`;
    const { pid } = await runner;
    try {
      expect(runner.pid).toBe(pid);
      expect(runner.finished).toBe(true);
      expect(runner.child).toBeNull();
      expect(activeProcessRunners.has(runner)).toBe(false);
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      process.kill(pid, 'SIGKILL');
    }
  });
});

describe('ProcessRunner#spawnDetached()', () => {
  test('runs an exec spec and resolves with { pid }', async () => {
    const dir = tempDir();
    const runner = new ProcessRunner(
      { mode: 'exec', file: node, args: ['-e', report] },
      { cwd: dir, env: { ...process.env, DETACH_VALUE: 'runner' } }
    );
    const result = await runner.spawnDetached();
    expect(Object.keys(result)).toEqual(['pid']);
    expect(await waitForFile(path.join(dir, 'out'))).toBe(
      `${result.pid}|${dir}|runner\n`
    );
  });

  test('refuses a runner that has already started', async () => {
    const runner = $({ mirror: false })`true`;
    await runner;
    await expect(runner.spawnDetached()).rejects.toThrow(/not started/);
  });
});
