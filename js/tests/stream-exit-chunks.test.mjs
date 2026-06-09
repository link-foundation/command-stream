import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';

// Regression tests for issue #155:
//   1. stream() must yield a { type: 'exit', code } chunk when the process exits
//   2. stream() must not hang forever when the process has exited but a
//      grandchild keeps the stdio pipes open

const isWindows = process.platform === 'win32';

test('stream() yields an exit chunk with the exit code (success)', async () => {
  const cmd = $({ mirror: false })`echo hello`;
  const chunks = [];
  for await (const chunk of cmd.stream()) {
    chunks.push(chunk);
  }

  const types = chunks.map((c) => c.type);
  expect(types).toContain('stdout');
  expect(types).toContain('exit');

  // The exit chunk must be the last chunk and carry the exit code.
  const exitChunk = chunks[chunks.length - 1];
  expect(exitChunk.type).toBe('exit');
  expect(exitChunk.code).toBe(0);
});

test.skipIf(isWindows)(
  'stream() exit chunk reports a non-zero exit code',
  async () => {
    const cmd = $({ mirror: false })`sh -c 'echo out; exit 7'`;
    const chunks = [];
    for await (const chunk of cmd.stream()) {
      chunks.push(chunk);
    }

    const exitChunk = chunks.find((c) => c.type === 'exit');
    expect(exitChunk).toBeDefined();
    expect(exitChunk.code).toBe(7);
  }
);

test.skipIf(isWindows)(
  'stream() does not hang when a grandchild keeps stdout open',
  async () => {
    // `sh` exits immediately after `echo done`, but the backgrounded `sleep`
    // inherits the stdout pipe and keeps it open. Before the fix this caused
    // stream() to hang until the sleep finished.
    const start = Date.now();
    const cmd = $({ mirror: false })`sh -c 'sleep 5 & echo done'`;

    const types = [];
    for await (const chunk of cmd.stream()) {
      types.push(chunk.type);
    }
    const elapsed = Date.now() - start;

    expect(types).toContain('stdout');
    expect(types).toContain('exit');
    // Must terminate quickly (grace period ~100ms) rather than waiting for the
    // 30s sleep. Allow generous headroom for slow CI.
    expect(elapsed).toBeLessThan(10000);

    // Clean up the lingering background sleep.
    cmd.kill('SIGKILL');
  },
  20000
);

test.skipIf(isWindows)(
  'await on a command does not hang when a grandchild keeps stdout open',
  async () => {
    const start = Date.now();
    const result = await $({ mirror: false })`sh -c 'sleep 5 & echo done'`;
    const elapsed = Date.now() - start;

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('done');
    expect(elapsed).toBeLessThan(10000);
  },
  20000
);
