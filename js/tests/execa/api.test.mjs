// Execa 9.6.1 public-contract checks for the adapter. The implementation is
// delegated to Execa; these tests verify our entry points and real processes.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { once } from 'node:events';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as upstream from 'execa';
import * as api from '../../src/execa/index.mjs';
import {
  $,
  execa,
  execaSync,
  execaNode,
  execaCommand,
  execaCommandSync,
} from '../../src/$.mjs';

const fixture = fileURLToPath(
  new URL('../fixtures/competitor-process.mjs', import.meta.url)
);
const node = process.execPath;
const args = (mode, ...values) => [fixture, mode, ...values];
const run = (mode, values = [], options = {}) =>
  api.execa(node, args(mode, ...values), options);
const require = createRequire(import.meta.url);

describe('Execa entry points', { timeout: 10_000 }, () => {
  test('re-exports every upstream method and error class without modification', () => {
    for (const [name, value] of Object.entries(upstream)) {
      assert.equal(api[name], value, name);
      assert.equal($.execaCompat()[name], value, name);
      assert.equal(require('../../src/execa/index.cjs')[name], value, name);
    }
  });

  for (const [name, method] of Object.entries({
    execa,
    execaSync,
    execaNode,
  })) {
    test(`general API ${name} preserves direct execution`, async () => {
      const result =
        name === 'execaNode'
          ? await method(fixture, ['argv', 'a b'], { ipc: false })
          : await method(node, args('argv', 'a b'));
      assert.deepEqual(JSON.parse(result.stdout), ['a b']);
    });
  }

  test('general command-string methods and parseCommandString preserve escaped spaces', async () => {
    assert.deepEqual(api.parseCommandString('echo hello\\ world'), [
      'echo',
      'hello world',
    ]);
    const command = `${node} ${fixture} argv hello\\ world`;
    assert.deepEqual(JSON.parse((await execaCommand(command)).stdout), [
      'hello world',
    ]);
    assert.deepEqual(JSON.parse(execaCommandSync(command).stdout), [
      'hello world',
    ]);
  });

  test('execaCompat create binds all methods and merges new defaults', async () => {
    const bound = $.execaCompat().create({ stripFinalNewline: false });
    assert.equal(
      (await bound.execa(node, args('stdio', 'hello\n'))).stdout,
      'hello\n'
    );
    assert.equal(
      bound.execaSync(node, args('stdio', 'hello\n')).stdout,
      'hello\n'
    );
    assert.equal(
      (await bound.execaNode(fixture, ['stdio', 'hello\n'], { ipc: false }))
        .stdout,
      'hello\n'
    );
    assert.equal(
      (await bound.$`${node} ${fixture} stdio ${'hello\n'}`).stdout,
      'hello\n'
    );
    assert.equal(
      (
        await bound
          .create({ stripFinalNewline: true })
          .execa(node, args('stdio', 'hello\n'))
      ).stdout,
      'hello'
    );
    assert.equal(
      (
        await $.execaCompat({ stripFinalNewline: false }).execa(
          node,
          args('stdio', 'hello\n')
        )
      ).stdout,
      'hello\n'
    );
  });

  test('nested factory defaults preserve Execa environment merging', async () => {
    const bound = api.create({
      env: { EXECA_A: 'first', EXECA_B: 'old' },
      extendEnv: false,
    });
    const nested = bound.create({ env: { EXECA_B: 'second' } });
    const result = await nested.execa(node, args('env', 'EXECA_A', 'EXECA_B'));
    assert.deepEqual(JSON.parse(result.stdout), {
      EXECA_A: 'first',
      EXECA_B: 'second',
    });
    const original = await bound.execa(node, args('env', 'EXECA_A', 'EXECA_B'));
    assert.deepEqual(JSON.parse(original.stdout), {
      EXECA_A: 'first',
      EXECA_B: 'old',
    });
  });

  test('identifies live subprocesses and rejects pid-shaped objects', async () => {
    const child = run('argv');
    assert.equal(api.isExecaChildProcess(child), true);
    for (const value of [null, undefined, {}, { pid: 1 }]) {
      assert.equal(api.isExecaChildProcess(value), false);
    }
    await child;
  });
});

describe('Execa execution and output', { timeout: 10_000 }, () => {
  const values = [
    '',
    'a b',
    '"',
    "'",
    '\\',
    '$HOME',
    ';',
    '|',
    '*',
    '日本語',
    'one\ntwo',
  ];
  for (const name of ['execa', 'execaSync']) {
    test(`${name} preserves exact argv including empty arguments`, async () => {
      assert.deepEqual(
        JSON.parse((await api[name](node, args('argv', ...values))).stdout),
        values
      );
    });
    test(`${name} template expands array arguments safely`, async () => {
      const result = await api[name]`${node} ${fixture} argv ${values}`;
      assert.deepEqual(JSON.parse(result.stdout), values);
    });
    test(`${name} supports options presets and call overrides`, async () => {
      const method = api[name]({ stripFinalNewline: false });
      assert.equal((await method(node, args('stdio', 'x\n'))).stdout, 'x\n');
      assert.equal(
        (await method(node, args('stdio', 'x\n'), { stripFinalNewline: true }))
          .stdout,
        'x'
      );
    });
    test(`${name} receives binary stdin with encoding: buffer`, async () => {
      const input = Buffer.from([0, 10, 13, 255, 128]);
      const result = await api[name](node, args('stdin'), {
        input,
        encoding: 'buffer',
        stripFinalNewline: false,
      });
      assert.deepEqual(result.stdout, new Uint8Array(input));
    });
  }

  test('strips exactly one CRLF, preserves earlier newlines', async () => {
    assert.equal((await run('stdio', ['a\r\n\r\n'])).stdout, 'a\r\n');
  });
  test('lines option separates output streams and handles empty output', async () => {
    const result = await run('stdio', ['one\ntwo\n', 'error\n'], {
      lines: true,
    });
    assert.deepEqual(result.stdout, ['one', 'two']);
    assert.deepEqual(result.stderr, ['error']);
    assert.deepEqual((await run('stdio', [''], { lines: true })).stdout, []);
  });
  test('all output is opt-in and includes both streams', async () => {
    assert.equal((await run('stdio', ['out', 'err'])).all, undefined);
    const { all } = await run('stdio', ['out', 'err'], { all: true });
    assert.ok(all.includes('out') && all.includes('err'));
  });
  test('cwd supports a URL and env can replace the inherited environment', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'execa-cwd-')));
    try {
      const { pathToFileURL } = await import('node:url');
      assert.equal(
        (await run('cwd', [], { cwd: pathToFileURL(dir) })).stdout,
        dir
      );
      const { stdout } = await run('env', ['EXECA_TEST', 'PATH'], {
        env: { EXECA_TEST: 'literal $ value' },
        extendEnv: false,
      });
      assert.deepEqual(JSON.parse(stdout), {
        EXECA_TEST: 'literal $ value',
        PATH: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('preferLocal finds a project-local executable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'execa-local-'));
    try {
      const bin = join(dir, 'node_modules', '.bin');
      mkdirSync(bin, { recursive: true });
      const file = join(
        bin,
        process.platform === 'win32' ? 'execa-probe.cmd' : 'execa-probe'
      );
      writeFileSync(
        file,
        process.platform === 'win32'
          ? '@echo local\r\n'
          : '#!/bin/sh\nprintf local',
        { mode: 0o755 }
      );
      assert.equal(
        (await api.execa('execa-probe', [], { cwd: dir, preferLocal: true }))
          .stdout,
        'local'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Execa errors and lifecycle', { timeout: 10_000 }, () => {
  test('async and sync errors preserve output, type and exit status', async () => {
    await assert.rejects(
      run('exit', ['42']),
      (error) =>
        error instanceof api.ExecaError && error.exitCode === 42 && error.failed
    );
    assert.throws(
      () => api.execaSync(node, args('exit', '42')),
      (error) => error instanceof api.ExecaSyncError && error.exitCode === 42
    );
    const result = await run('exit', ['42'], { reject: false });
    assert.equal(result.exitCode, 42);
    assert.equal(result.failed, true);
    assert.equal(result.timedOut, false);
  });
  test('spawn errors retain ENOENT instead of inventing an exit code', async () => {
    await assert.rejects(
      api.execa('command-stream-execa-missing-command-24'),
      (error) => error.code === 'ENOENT' && error.exitCode === undefined
    );
  });
  test('timeout terminates a finite child and reports timedOut', async () => {
    const result = await run('delayed', ['start', 'finish', '2000'], {
      timeout: 100,
      reject: false,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.failed, true);
  });
  test('cancelSignal reports cancellation', async () => {
    const controller = new AbortController();
    const child = run('delayed', ['start', 'finish', '2000'], {
      cancelSignal: controller.signal,
      reject: false,
    });
    await once(child.stdout, 'data');
    controller.abort();
    assert.equal((await child).isCanceled, true);
  });
  test('maxBuffer bounds capture and reports overflow', async () => {
    const result = await run('output', ['4096'], {
      maxBuffer: 128,
      reject: false,
    });
    assert.equal(result.isMaxBuffer, true);
    assert.equal(result.failed, true);
  });
});

describe('Execa streaming, pipes and IPC', { timeout: 10_000 }, () => {
  test('async iteration receives output before completion', async () => {
    const child = run('delayed', ['first\n', 'second\n', '200']);
    let finished = false;
    const completion = child.then(() => {
      finished = true;
    });
    const lines = [];
    for await (const line of child) {
      if (lines.length === 0) {
        assert.equal(finished, false);
      }
      lines.push(line);
    }
    await completion;
    assert.deepEqual(lines, ['first', 'second']);
  });
  test('buffer: false keeps readable streaming and does not capture stdout', async () => {
    const child = run('stdio', ['streamed'], { buffer: false });
    const chunks = [];
    for await (const chunk of child.stdout) {
      chunks.push(chunk);
    }
    assert.equal(Buffer.concat(chunks).toString(), 'streamed');
    assert.equal((await child).stdout, undefined);
  });
  test('programmatic pipe transfers output without a shell', async () => {
    const result = await run('stdio', ['piped']).pipe(node, args('stdin'));
    assert.equal(result.stdout, 'piped');
    assert.equal(result.pipedFrom[0].stdout, 'piped');
  });
  test('generator transforms are passed through', async () => {
    const result = await run('stdio', ['hello\n'], {
      *stdout(line) {
        yield line.toUpperCase();
      },
    });
    assert.equal(result.stdout, 'HELLO');
  });
  test(
    'execaNode supports bidirectional IPC',
    {
      skip: process.versions.bun
        ? 'Execa IPC requires Node channel.refCounted(), unavailable in Bun'
        : false,
    },
    async () => {
      const ipc = fileURLToPath(new URL('fixtures/ipc.mjs', import.meta.url));
      // execaNode defaults to the host executable (Node in the Node CI job).
      const child = api.execaNode(ipc);
      await child.sendMessage({ value: 24 });
      assert.deepEqual(await child.getOneMessage(), {
        received: { value: 24 },
      });
      const result = await child;
      assert.deepEqual(result.ipcOutput, [{ received: { value: 24 } }]);
    }
  );
});
