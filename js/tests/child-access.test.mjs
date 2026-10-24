/**
 * Regression tests for issue #20: the child handle must be reachable early
 * enough to stop a command through `runner.child.kill(signal)`.
 *
 * Rust mirrors this contract in `rust/tests/child_access.rs` with its
 * language-idiomatic borrowed child handle.
 */
import { describe, expect, test } from 'bun:test';
import './test-helper.mjs';
import { $ } from '../src/$.mjs';

const quiet = { mirror: false, capture: true };
const runtime = process.execPath;
const idleFor = (seconds) =>
  $(quiet)`${runtime} -e ${`setTimeout(() => {}, ${seconds * 1000})`}`;

describe('issue #20 - child access', () => {
  test('returns a usable child handle synchronously', async () => {
    const runner = idleFor(5);

    const child = runner.child;

    expect(runner.started).toBe(true);
    expect(child).not.toBeNull();
    expect(typeof child.kill).toBe('function');

    child.kill('SIGTERM');
    const result = await runner;

    expect(result.code).toBe(143);
    expect(runner.pid).toBeUndefined();
  });

  test('cancels pending startup for commands that require a real shell', async () => {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const runner = $(
      quiet
    )`${runtime} -e ${'setTimeout(() => {}, 5000)'} > ${nullDevice}`;

    runner.child.kill('SIGTERM');
    const result = await runner;

    expect(result.code).toBe(143);
    expect(runner.pid).toBeUndefined();
  });

  test('the early handle follows the native child after spawn', async () => {
    const runner = idleFor(5);
    const child = runner.child;

    await runner.streams.stdout;

    expect(child.pid).toBe(runner.pid);
    expect(child.native).toBe(runner.child);
    expect(child.native.pid).toBeGreaterThan(0);

    child.kill('SIGTERM');
    const result = await runner;
    expect(result.code).toBe(143);
  });

  test('can stop an in-process command through its child handle', async () => {
    const runner = $(quiet)`sleep 5`;

    const child = runner.child;
    child.kill('SIGTERM');
    const result = await runner;

    expect(result.code).toBe(143);
    expect(runner.pid).toBeUndefined();
  });

  test('is released after completion', async () => {
    const runner = $(quiet)`echo done`;
    const child = runner.child;

    await runner;

    expect(child).not.toBeNull();
    expect(runner.child).toBeNull();
  });
});
