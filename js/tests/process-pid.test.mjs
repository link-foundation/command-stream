// Tests for issue #18:
// "We need example in docs on how to get PID of started command"
//
// Before the fix there was no supported way to read the pid. The only handle
// was `runner.child.pid`, which:
//   1. is `null.pid` (a TypeError) after the command finishes, because
//      _cleanup() releases `child` in finish();
//   2. is not populated right after `start()`, which returns a promise rather
//      than a spawned child;
//   3. is absent for built-in commands with no indication of why.
//
// `runner.pid` records the id at spawn time, so it survives cleanup and answers
// the same way on every execution path.
import { test, expect, describe } from 'bun:test';
import './test-helper.mjs'; // installs beforeEach/afterEach resetGlobalState
import { $ } from '../src/$.mjs';
import { ProcessRunner } from '../src/process-runner.mjs';
import { execSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const quiet = { mirror: false, capture: true };

// The runtime running these tests is the one executable guaranteed to exist on
// every platform in the matrix, and it is never a built-in, so it always
// produces a real child process.
const runtime = process.execPath;
const idleFor = (seconds) =>
  $(quiet)`${runtime} -e ${`setTimeout(() => {}, ${seconds * 1000})`}`;
const printHello = () => $(quiet)`${runtime} -e ${'process.stdout.write("hi")'}`;

describe('issue #18 - process id access', () => {
  test('is undefined before the command starts', async () => {
    const runner = printHello();
    expect(runner.started).toBe(false);
    expect(runner.pid).toBeUndefined();

    await runner; // settle it so the runner is not left dangling
  });

  test('is available while the command is still running', async () => {
    const runner = idleFor(5);
    await runner.streams.stdout;

    expect(typeof runner.pid).toBe('number');
    expect(runner.pid).toBeGreaterThan(0);

    runner.kill();
    await runner.catch(() => {});
  });

  test('survives completion, unlike child which is released', async () => {
    const runner = idleFor(0.2);
    await runner.streams.stdout;
    const whileRunning = runner.pid;
    expect(typeof whileRunning).toBe('number');

    await runner;

    // The regression this guards: `child` is intentionally dropped by
    // _cleanup(), so `runner.child.pid` throws once the command is done.
    expect(runner.child).toBeNull();
    expect(runner.pid).toBe(whileRunning);
  });

  test('is available after a plain await, without touching the streams', async () => {
    const runner = printHello();
    const result = await runner;

    expect(result.code).toBe(0);
    expect(typeof runner.pid).toBe('number');
  });

  test('is available in sync mode', () => {
    const runner = printHello();
    const result = runner.sync();

    expect(result.code).toBe(0);
    expect(typeof runner.pid).toBe('number');
  });

  test('is available while iterating a stream', async () => {
    const runner = printHello();
    let seenDuringIteration;

    for await (const chunk of runner.stream()) {
      seenDuringIteration ??= runner.pid;
      void chunk;
    }

    expect(typeof seenDuringIteration).toBe('number');
    expect(runner.pid).toBe(seenDuringIteration);
  });

  test('stays undefined for built-in commands, which spawn no process', async () => {
    // `echo` is a built-in: it runs inside this process, so there is no
    // operating system process to identify.
    const runner = $(quiet)`echo hello`;
    const result = await runner;

    expect(result.stdout).toBe('hello\n');
    expect(runner.pid).toBeUndefined();
  });

  test('distinct commands report distinct ids', async () => {
    const first = idleFor(5);
    const second = idleFor(5);
    await Promise.all([first.streams.stdout, second.streams.stdout]);

    expect(first.pid).not.toBe(second.pid);

    first.kill();
    second.kill();
    await Promise.all([first.catch(() => {}), second.catch(() => {})]);
  });

  test('names a live process that can be signalled', async () => {
    const runner = idleFor(5);
    await runner.streams.stdout;
    const pid = runner.pid;

    // Signal 0 performs the permission/existence check without delivering
    // anything, which is exactly the "is my command still running?" question
    // the pid is wanted for.
    expect(() => process.kill(pid, 0)).not.toThrow();

    runner.kill();
    await runner.catch(() => {});
  });
});

// `ps` is the reference for "which process is this really?", and it is POSIX
// only. The behavior it pins down (shell wrapper vs. exact executable) is not
// Unix-specific, but its verification is.
describe.skipIf(isWindows)('issue #18 - what the id names', () => {
  test('a shell command reports the shell that runs it', async () => {
    // Worth pinning down because it is surprising: a command string goes
    // through the platform shell, so the pid names that shell and the command
    // itself is its child. The shell leads its own process group, which is how
    // kill() reaches both.
    const runner = $(quiet)`/bin/sleep 5`;
    await runner.streams.stdout;
    const pid = runner.pid;

    const args = execSync(`ps -o args= -p ${pid}`).toString().trim();
    expect(args).toContain('/bin/sleep 5');
    expect(args).not.toBe('/bin/sleep 5'); // a shell wrapper, not the command

    const pgid = Number(execSync(`ps -o pgid= -p ${pid}`).toString().trim());
    expect(pgid).toBe(pid);

    runner.kill();
    await runner.catch(() => {});
  });

  test('exec mode reports the command itself, with no shell in between', async () => {
    const runner = new ProcessRunner(
      { mode: 'exec', file: '/bin/sleep', args: ['5'] },
      quiet
    );
    await runner.streams.stdout;

    const args = execSync(`ps -o args= -p ${runner.pid}`).toString().trim();
    expect(args).toBe('/bin/sleep 5');

    runner.kill();
    await runner.catch(() => {});
  });
});
