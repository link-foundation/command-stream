import { expect, test } from 'bun:test';
import './test-helper.mjs';
import { $, enableVirtualCommands, register, unregister } from '../src/$.mjs';

function nextWithin(iterator, timeoutMs = 1000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`stream did not yield within ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([iterator.next(), timeout]).finally(() =>
    clearTimeout(timer)
  );
}

test('streams a virtual command before the next command in a sequence completes', async () => {
  enableVirtualCommands();

  let releaseBlockedCommand;
  const blockedCommand = new Promise((resolve) => {
    releaseBlockedCommand = resolve;
  });

  let markBlockedCommandStarted;
  const blockedCommandStarted = new Promise((resolve) => {
    markBlockedCommandStarted = resolve;
  });

  register('issue-43-blocked', async () => {
    markBlockedCommandStarted();
    await blockedCommand;
    return { code: 0, stdout: 'after\n' };
  });

  const runner = $({
    mirror: false,
  })`echo before; issue-43-blocked`;
  const iterator = runner.stream()[Symbol.asyncIterator]();

  try {
    const first = await nextWithin(iterator);
    expect(first.done).toBe(false);
    expect(first.value.type).toBe('stdout');
    expect(first.value.data.toString()).toBe('before\n');

    await blockedCommandStarted;

    const pendingSecond = iterator.next();
    const prematureResult = await Promise.race([
      pendingSecond.then(() => 'yielded'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 25)),
    ]);
    expect(prematureResult).toBe('blocked');

    releaseBlockedCommand();

    const second = await pendingSecond;
    expect(second.done).toBe(false);
    expect(second.value.type).toBe('stdout');
    expect(second.value.data.toString()).toBe('after\n');

    const exit = await nextWithin(iterator);
    expect(exit.done).toBe(false);
    expect(exit.value).toEqual({ type: 'exit', code: 0 });

    const end = await nextWithin(iterator);
    expect(end.done).toBe(true);
  } finally {
    releaseBlockedCommand();
    await iterator.return();
    unregister('issue-43-blocked');
  }
}, 3000);
