import { test, expect } from 'bun:test';
import { once } from 'node:events';
import { access, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startRustRepl } from '../src/$.mjs';

const fixture = resolve('experiments/issue-32/fake-evcxr.mjs');
const options = {
  executable: process.execPath,
  args: [fixture],
  cratePath: resolve('rust'),
  stdio: ['ignore', 'pipe', 'pipe'],
  disableReadline: true,
};

test('Rust REPL loads the full local crate in an isolated session and cleans up', async () => {
  const controller = await startRustRepl(options);
  let stdout = '';
  controller.child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  expect((await controller.done).code).toBe(0);
  const config = JSON.parse(stdout);
  expect(config.manifest).toContain(JSON.stringify(await realpath('rust')));
  expect(config.manifest).toContain('package = "command-stream"');
  expect(config.init).toContain('features = ["full"]');
  expect(config.manifest).toContain('crate-type = ["dylib"]');
  expect(config.facade).toContain('pub use command_stream::*;');
  expect(config.prelude).toBe('use command_stream::*;\n');
  await expect(access(config.directory)).rejects.toThrow();
});

test('Rust REPL close terminates an evaluator ignoring SIGTERM', async () => {
  const controller = await startRustRepl({
    ...options,
    args: [fixture, '--hold'],
  });
  try {
    const [chunk] = await once(controller.child.stdout, 'data');
    const config = JSON.parse(String(chunk));
    await controller.close();
    await expect(access(config.directory)).rejects.toThrow();
  } finally {
    await controller.close();
  }
}, 5000);

test('missing Rust evaluator explains how to install it', async () => {
  await expect(
    startRustRepl({ ...options, executable: resolve('missing-evcxr') })
  ).rejects.toThrow('cargo install --locked evcxr_repl');
});
