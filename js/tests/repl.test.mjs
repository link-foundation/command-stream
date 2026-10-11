import { test, expect, beforeEach, afterEach } from 'bun:test';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as api from '../src/$.mjs';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';

beforeEach(beforeTestCleanup);
afterEach(afterTestCleanup);

function fixture() {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = api.startRepl({ input, output, terminal: false });
  output.resume();
  const evaluate = (source) =>
    new Promise((resolve, reject) => {
      server.eval(
        `${source}\n`,
        server.context,
        'repl-test',
        (error, value) => {
          if (error) {
            reject(error);
          } else {
            resolve(value);
          }
        }
      );
    });
  return { server, evaluate };
}

test('REPL exposes every public export with the original identity', () => {
  const { server } = fixture();
  try {
    for (const name of Object.keys(api).filter((name) => name !== 'default')) {
      expect(server.context[name]).toBe(api[name]);
    }
  } finally {
    server.close();
  }
});

test('REPL preserves declarations and evaluates classes and new expressions', async () => {
  const { server, evaluate } = fixture();
  try {
    await evaluate('const persisted = 41');
    expect(await evaluate('persisted + 1')).toBe(42);
    await evaluate('class Example { value() { return 42; } }');
    expect(await evaluate('new Example().value()')).toBe(42);
    expect((await evaluate('new Map([["a", 42]])')).get('a')).toBe(42);
    await evaluate('const echo = 42');
    expect(await evaluate('echo')).toBe(42);
    expect(await evaluate('echo - 1')).toBe(41);
  } finally {
    server.close();
  }
});

test('REPL permits top-level await, streaming loops and full pipeline APIs', async () => {
  const { server, evaluate } = fixture();
  try {
    await evaluate('const result = await $({ mirror: false })`echo retained`');
    expect(String(await evaluate('result.stdout'))).toBe('retained\n');
    await evaluate('let collected = ""');
    await evaluate(
      'for await (const chunk of $({ mirror: false })`echo streamed`.stream()) { if (chunk.type === "stdout") collected += chunk.data; }'
    );
    expect(await evaluate('collected')).toBe('streamed\n');
    expect(
      await evaluate('await stream([1, 2]).map(x => x * 2).toArray()')
    ).toEqual([2, 4]);
    expect(
      await evaluate(
        'await exec(process.execPath, ["-e", "process.stdout.write(String.fromCharCode(101,120,101,99))"], { mirror: false }).then(r => r.text())'
      )
    ).toBe('exec');
  } finally {
    server.close();
  }
});

test('REPL executes registered command arguments and pipelines', async () => {
  const { server, evaluate } = fixture();
  try {
    await evaluate(
      'register("deploy-fixture", async ({ args }) => ({ stdout: args.join(" ") + "\\n", code: 0 }))'
    );
    expect(
      await (await evaluate('deploy-fixture --env=staging | cat')).text()
    ).toBe('--env=staging\n');
    expect(await (await evaluate('echo bare-shell')).text()).toBe(
      'bare-shell\n'
    );
  } finally {
    server.close();
    api.unregister('deploy-fixture');
  }
});

test('clearing the REPL restores every public API', () => {
  const { server } = fixture();
  try {
    server.resetContext();
    for (const name of Object.keys(api).filter((name) => name !== 'default')) {
      expect(server.context[name]).toBe(api[name]);
    }
  } finally {
    server.close();
  }
});

test('Node CLI evaluates multiline JavaScript and exits its REPL', () => {
  const result = spawnSync('node', [resolve('js/src/cli.mjs'), 'repl'], {
    input:
      'class Multiline {\nvalue() { return 42; }\n}\nnew Multiline().value()\nawait stream([1, 2]).map(x => x * 2).toArray()\n.commands\n.exit\n',
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('42');
  expect(result.stdout).toContain('[ 2, 4 ]');
  expect(result.stdout).toContain('Registered virtual commands:');
  expect(result.stderr).toBe('');
});
