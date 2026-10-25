import { test, expect, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import {
  $,
  compose,
  create,
  raw,
  listCommands,
  unregister,
} from '../src/$.mjs';
import { createCommand } from '../src/command-packages.mjs';
import { create as coreCreate } from '../src/core.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

beforeEach(beforeTestCleanup);
afterEach(afterTestCleanup);

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const registrations = [
  $.create,
  create,
  coreCreate,
  require('../src/$.cjs').create,
  require('../src/core.cjs').create,
  createCommand,
];
const handler = () => ({ code: 0, stdout: 'hello' });
const invalidNames = [null, undefined, 42, true, {}, ['command']];

test.each(invalidNames.map((name) => [name]))(
  'command creation rejects non-string name %j before registry mutation',
  (name) => {
    const original = listCommands();
    for (const register of registrations) {
      expect(() => register(name, handler)).toThrow(TypeError);
      expect(listCommands()).toEqual(original);
    }
  }
);

test('configured tags and valid custom command names still work', async () => {
  const quiet = $.create({ mirror: false, capture: true });
  expect(await (await quiet`echo configured`).text()).toBe('configured\n');
  for (const name of [
    'ecosystem:hello',
    'ecosystem-hello',
    'ecosystem.hello',
  ]) {
    try {
      expect($.create(name, handler)).toBe(handler);
      expect(await (await $({ mirror: false })`${raw(name)}`).text()).toBe(
        'hello'
      );
    } finally {
      unregister(name);
    }
  }
});

test('invalid names and handlers fail without registering partial commands', () => {
  const original = listCommands();
  for (const name of [
    '',
    'two words',
    '7command',
    'command;echo',
    'écho',
    'ecosystem-newline\n',
    'ecosystem-newline\r',
    'ecosystem-newline\r\n',
  ]) {
    expect(() => $.create(name, handler)).toThrow(TypeError);
  }
  expect(() => $.create('ecosystem-invalid', null)).toThrow(TypeError);
  expect(listCommands()).toEqual(original);
});

test('the reload example is an installable package with idempotent installation', async () => {
  const file = fileURLToPath(
    new URL('../examples/test-hot-reload-cmd.mjs', import.meta.url)
  );
  const installed = await $.install(file, { install: false });
  try {
    expect(await $.install(file, { install: false })).toBe(installed);
    expect(await (await $({ mirror: false })`hot-demo Alice`).text()).toBe(
      'Reloadable greeting: Alice\n'
    );
    await installed.reload();
    expect(await (await $({ mirror: false })`hot-demo Bob`).text()).toBe(
      'Reloadable greeting: Bob\n'
    );
  } finally {
    installed.uninstall();
  }
  expect(listCommands()).not.toContain('hot-demo');
});

test.each([[], [null], [undefined], [handler, null]])(
  'composition rejects invalid handlers with a validation error: %j',
  (...handlers) => {
    const original = process.env.COMMAND_STREAM_TRACE;
    try {
      for (const tracing of ['false', 'true']) {
        process.env.COMMAND_STREAM_TRACE = tracing;
        expect(() => compose(...handlers)).toThrow(
          'Composition requires command handlers'
        );
      }
    } finally {
      if (original === undefined) {
        delete process.env.COMMAND_STREAM_TRACE;
      } else {
        process.env.COMMAND_STREAM_TRACE = original;
      }
    }
  }
);

test('middleware and inheritance preserve incremental async-generator output', async () => {
  let release;
  const resumed = new Promise((resolve) => {
    release = resolve;
  });
  $.create('ecosystem-stream', async function* ({ args }) {
    yield `first:${args.join(' ')}\n`;
    await resumed;
    yield 'second\n';
  });
  $.extend('ecosystem-stream', async (context, next) => next(context));
  $.inherit('ecosystem-child', 'ecosystem-stream', { args: ['inherited'] });
  const runner = $({ mirror: false, capture: false })`ecosystem-child value`;
  const iterator = runner.stream().lines()[Symbol.asyncIterator]();
  try {
    expect(await iterator.next()).toEqual({
      value: 'first:inherited value',
      done: false,
    });
    release();
    expect(await iterator.next()).toEqual({ value: 'second', done: false });
    expect((await iterator.next()).done).toBe(true);
    expect(runner.result.code).toBe(0);
  } finally {
    release();
    await iterator.return();
    unregister('ecosystem-child');
    unregister('ecosystem-stream');
  }
}, 5000);

test('composition passes generator output to stdin and stops at failure', async () => {
  let reached = false;
  const pipeline = compose(
    async function* () {
      yield 'one\n';
      yield Buffer.from('two\n');
    },
    ({ stdin }) => ({ code: 7, stdout: stdin.toUpperCase(), stderr: 'stop' }),
    () => {
      reached = true;
      return { code: 0 };
    }
  );
  $.create('ecosystem-pipeline', pipeline);
  try {
    const result = await $({
      mirror: false,
      errexit: false,
    })`ecosystem-pipeline`;
    expect(await result.text()).toBe('ONE\nTWO\n');
    expect(result.stderr.toString()).toBe('stop');
    expect(result.code).toBe(7);
    expect(reached).toBe(false);
  } finally {
    unregister('ecosystem-pipeline');
  }
});

test('marketplace forwards registry, cancellation and bounded search size', async () => {
  const controller = new AbortController();
  let request;
  const result = await $.marketplace.search('git & deploy', {
    registry: 'https://registry.example.test',
    signal: controller.signal,
    size: 999,
    fetch: (url, options) => {
      request = { url: new URL(url), options };
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ objects: [{ package: { name: 'tools' } }] }),
      });
    },
  });
  expect(result).toEqual([{ name: 'tools' }]);
  expect(request.url.origin).toBe('https://registry.example.test');
  expect(request.url.searchParams.get('text')).toBe(
    'keywords:command-stream-command git & deploy'
  );
  expect(request.url.searchParams.get('size')).toBe('250');
  expect(request.options.signal).toBe(controller.signal);
  await expect(
    $.marketplace.search('git', {
      fetch: () => Promise.resolve({ ok: false, status: 503 }),
    })
  ).rejects.toThrow('Marketplace search failed: 503');
});

test.each(['virtual-ecosystem-demo.mjs', 'enterprise-virtual-commands.mjs'])(
  '%s completes in Node and Bun without registry access',
  async (name) => {
    const file = fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
    for (const runtime of ['node', 'bun']) {
      const { stdout, stderr } = await execute(runtime, [file]);
      expect(stdout).toContain('Demo complete');
      expect(stderr).toBe('');
    }
  },
  10000
);
