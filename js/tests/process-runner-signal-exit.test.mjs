// Shared regression suite for Bun and the Node 20/22/24 CI matrix (issue #208).
import assert from 'node:assert/strict';
import { constants } from 'node:os';
import { afterEach, test } from 'node:test';
import { $, ProcessRunner, resetGlobalState, set } from '../src/$.mjs';
import { getSyncStdinInput } from '../src/$.result.mjs';

const options = { mirror: false, capture: true, stdin: 'ignore' };
const posix = { skip: process.platform === 'win32', timeout: 5000 };
const forms = {
  'shell file/args': (command) => ({ mode: 'shell', file: command, args: [] }),
  'shell command': (command) => ({ mode: 'shell', command }),
  exec: (command) => ({ mode: 'exec', file: 'sh', args: ['-c', command] }),
};

afterEach(() => resetGlobalState());

for (const [form, makeSpec] of Object.entries(forms)) {
  for (const signal of ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGUSR1']) {
    const command = `kill -${signal.slice(3)} $$`;
    const code = 128 + constants.signals[signal];

    test(`${form}: await reports ${signal}`, posix, async () => {
      const runner = new ProcessRunner(makeSpec(command), options);
      let exit;
      runner.on('exit', (...args) => {
        exit = args;
      });
      const result = await runner;
      assert.equal(result.code, code);
      assert.equal(result.exitCode, code);
      assert.equal(result.signal, signal);
      assert.equal(runner.result.signal, signal);
      assert.deepEqual(exit, [code, signal]);
    });

    test(`${form}: sync reports ${signal}`, posix, () => {
      const result = new ProcessRunner(makeSpec(command), options).sync();
      assert.equal(result.code, code);
      assert.equal(result.exitCode, code);
      assert.equal(result.signal, signal);
    });

    test(`${form}: stream reports ${signal}`, posix, async () => {
      const runner = new ProcessRunner(makeSpec(command), options);
      const chunks = [];
      for await (const chunk of runner.stream()) {
        chunks.push(chunk);
      }
      assert.deepEqual(chunks.at(-1), { type: 'exit', code, signal });
      assert.equal(chunks.filter((chunk) => chunk.type === 'exit').length, 1);
    });
  }
}

for (const code of [0, 3, 137]) {
  test(`ordinary exit ${code} has no signal`, { timeout: 5000 }, async () => {
    const spec = {
      mode: 'exec',
      file: process.execPath,
      args: ['-e', `process.exit(${code})`],
    };
    const result = await new ProcessRunner(spec, options);
    const syncResult = new ProcessRunner(spec, options).sync();
    for (const value of [result, syncResult]) {
      assert.equal(value.code, code);
      assert.equal(value.signal, null);
    }
    const chunks = [];
    for await (const chunk of new ProcessRunner(spec, options).stream()) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks.at(-1), { type: 'exit', code, signal: null });
  });
}

test(
  'virtual commands and launch failures have no signal',
  { timeout: 5000 },
  async () => {
    assert.equal((await $({ mirror: false })`echo done`).signal, null);
    const result = await new ProcessRunner(
      { mode: 'exec', file: `command-stream-missing-${process.pid}`, args: [] },
      options
    );
    assert.equal(result.code, 127);
    assert.equal(result.signal, null);
  }
);

test(
  'cancellation reports the requested signal before spawn',
  { timeout: 5000 },
  async () => {
    const runner = new ProcessRunner(
      { mode: 'exec', file: process.execPath, args: ['-e', 'process.exit(0)'] },
      options
    );
    runner.kill('SIGKILL');
    assert.equal((await runner).signal, 'SIGKILL');
    assert.equal(runner.result.code, 137);
  }
);

test('stream cancellation reports the requested signal', posix, async () => {
  // A finite producer keeps the probe bounded even if cancellation regresses.
  const runner = new ProcessRunner(forms.exec('echo ready; sleep 2'), {
    ...options,
    killSignal: 'SIGINT',
    killGrace: 0,
  });
  const chunks = [];
  for await (const chunk of runner.stream()) {
    chunks.push(chunk);
    if (chunk.type === 'stdout') {
      runner.kill();
    }
  }
  assert.deepEqual(chunks.at(-1), {
    type: 'exit',
    code: 130,
    signal: 'SIGINT',
  });
  assert.equal((await runner).signal, 'SIGINT');
});

test(
  'explicit stdin preserves signal termination on the Node spawn path',
  posix,
  async () => {
    for (const stdin of ['', Buffer.from('input')]) {
      const result = await new ProcessRunner(forms.exec('kill -KILL $$'), {
        ...options,
        stdin,
      });
      assert.equal(result.code, 137);
      assert.equal(result.signal, 'SIGKILL');
    }
  }
);

test(
  'errexit rejects signal termination and retains the signal in its result',
  posix,
  async () => {
    set('e');
    await assert.rejects(
      async () =>
        await new ProcessRunner(
          forms['shell file/args']('kill -TERM $$'),
          options
        ),
      (error) =>
        error.code === 143 &&
        error.exitCode === 143 &&
        error.result.signal === 'SIGTERM'
    );
  }
);

test('sync stdio keywords are modes rather than input bytes', () => {
  for (const mode of ['ignore', 'inherit', 'pipe']) {
    assert.equal(getSyncStdinInput(mode), undefined);
  }
  assert.equal(getSyncStdinInput('hello').toString(), 'hello');
});
