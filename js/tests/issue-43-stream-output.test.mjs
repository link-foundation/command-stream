import { expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('forwards output from a real command nested in a streamed sequence', async () => {
  enableVirtualCommands();

  const releaseFile = join(
    tmpdir(),
    `command-stream-issue-43-${process.pid}-${Date.now()}`
  );
  const childScript = [
    'import { existsSync } from "node:fs";',
    'process.stdout.write("child-ready\\n");',
    'while (!existsSync(process.argv.at(1))) {',
    '  await new Promise((resolve) => setTimeout(resolve, 10));',
    '}',
    'process.stdout.write("child-done\\n");',
  ].join(' ');

  const runner = $({
    mirror: false,
  })`echo before; ${process.execPath} -e ${childScript} ${releaseFile}`;
  const iterator = runner.stream()[Symbol.asyncIterator]();

  try {
    const first = await nextWithin(iterator);
    expect(first.value.type).toBe('stdout');
    expect(first.value.data.toString()).toBe('before\n');

    const ready = await nextWithin(iterator);
    expect(ready.value.type).toBe('stdout');
    expect(ready.value.data.toString()).toBe('child-ready\n');

    writeFileSync(releaseFile, '');

    const done = await nextWithin(iterator);
    expect(done.value.type).toBe('stdout');
    expect(done.value.data.toString()).toBe('child-done\n');

    const exit = await nextWithin(iterator);
    expect(exit.value).toEqual({ type: 'exit', code: 0 });
  } finally {
    writeFileSync(releaseFile, '');
    await iterator.return();
    rmSync(releaseFile, { force: true });
  }
}, 3000);

test('keeps quoted shell metacharacters inside virtual command arguments', async () => {
  enableVirtualCommands();
  register('issue-43-custom', async () => ({
    code: 0,
    stdout: 'custom\n',
  }));

  try {
    const stdout = [];
    for await (const chunk of $({
      mirror: false,
    })`echo "literal; * [ ?"; issue-43-custom`.stream()) {
      if (chunk.type === 'stdout') {
        stdout.push(chunk.data.toString());
      }
    }

    expect(stdout.join('')).toBe('literal; * [ ?\ncustom\n');
  } finally {
    unregister('issue-43-custom');
  }
});

test('breaking a sequence stream kills its active nested command', async () => {
  enableVirtualCommands();

  const childScript = [
    'process.stdout.write("child-ready\\n");',
    'setInterval(function () {}, 1000);',
  ].join(' ');
  const runner = $({
    mirror: false,
  })`echo before; ${process.execPath} -e ${childScript}`;

  let sawNestedOutput = false;
  for await (const chunk of runner.stream()) {
    if (chunk.type === 'stdout' && chunk.data.toString() === 'child-ready\n') {
      sawNestedOutput = true;
      break;
    }
  }

  expect(sawNestedOutput).toBe(true);
  expect(runner.finished).toBe(true);
  expect(runner.result.code).toBe(143);
}, 3000);

test.skipIf(process.platform === 'win32')(
  'falls back to the real shell for a background operator',
  async () => {
    enableVirtualCommands();

    const stdout = [];
    for await (const chunk of $({
      mirror: false,
    })`sleep 0.01 & echo background`.stream()) {
      if (chunk.type === 'stdout') {
        stdout.push(chunk.data.toString());
      }
    }

    expect(stdout.join('')).toBe('background\n');
  }
);

test('a streamed sequence with virtual sleep releases its timers', async () => {
  const examplePath = fileURLToPath(
    new URL('../examples/streaming-compound-commands.mjs', import.meta.url)
  );
  const child = Bun.spawn([process.execPath, examplePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timer;
  try {
    const exitCode = await Promise.race([
      child.exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('streaming example did not exit')),
          1000
        );
      }),
    ]);
    expect(exitCode).toBe(0);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}, 3000);
