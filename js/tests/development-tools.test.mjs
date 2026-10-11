import { test, expect } from 'bun:test';
import * as api from '../src/$.mjs';
import { PassThrough } from 'node:stream';

test('REPL accepts JavaScript and registered bare commands', async () => {
  expect(typeof api.startRepl).toBe('function');
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => {
    text += chunk;
  });
  const repl = api.startRepl({ input, output, terminal: false });
  const evaluate = (source) =>
    new Promise((resolve, reject) =>
      repl.eval(source, repl.context, 'fixture', (error, value) =>
        error ? reject(error) : resolve(value)
      )
    );
  try {
    await evaluate(
      "$.register('repl-fixture', async () => ({stdout: 'ready'}))\n"
    );
    const result = await evaluate('repl-fixture\n');
    expect(await result.text()).toBe('ready');
    expect(repl.commandNames()).toContain('repl-fixture');
  } finally {
    repl.close();
    api.unregister('repl-fixture');
  }
});

test('debugger gates stages and records data, time and memory', async () => {
  expect(typeof api.PipelineDebugger).toBe('function');
  const debugger_ = new api.PipelineDebugger({ paused: true });
  const pipeline = debugger_.stage(
    'double',
    api.stream([2]).map((x) => x * 2)
  );
  const result = pipeline.toArray();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(debugger_.timeline).toHaveLength(0);
  debugger_.step();
  expect(await result).toEqual([4]);
  expect(debugger_.timeline[0].value).toBe(4);
  expect(debugger_.timeline[0].memory).toBeGreaterThan(0);
  expect(debugger_.visualize()).toContain('double');
});

test('scoped mock commands restore handlers even when assertions fail', async () => {
  expect(typeof api.testing?.withMocks).toBe('function');
  await api.testing.withMocks(
    { 'mock-fixture': { stdout: 'mocked', code: 0 } },
    async () => {
      const result = await api.sh('mock-fixture', { mirror: false });
      await api.testing.expectOutput(result, 'mocked');
    }
  );
  expect(api.listCommands()).not.toContain('mock-fixture');
});
