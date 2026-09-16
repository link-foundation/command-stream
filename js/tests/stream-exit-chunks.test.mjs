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

test.skipIf(isWindows)(
  'stream() can be stopped from inside the loop with kill()',
  async () => {
    // Endless producer: without stopping it, the loop would never end.
    const cmd = $({
      mirror: false,
    })`sh -c 'i=0; while true; do i=$((i+1)); echo line-$i; sleep 0.05; done'`;

    const start = Date.now();
    const stdoutCount = [];
    let exitChunk;
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout') {
        stdoutCount.push(chunk.data.toString());
        if (stdoutCount.length >= 3) {
          cmd.kill(); // stop the process from inside the loop
        }
      } else if (chunk.type === 'exit') {
        exitChunk = chunk;
      }
    }
    const elapsed = Date.now() - start;

    // The loop ends promptly after kill() rather than running forever.
    expect(stdoutCount.length).toBeGreaterThanOrEqual(3);
    expect(elapsed).toBeLessThan(10000);
    // A kill() still yields a terminating exit chunk (SIGTERM => 143).
    expect(exitChunk).toBeDefined();
    expect(exitChunk.code).toBe(143);
    expect(cmd.finished).toBe(true);
  },
  20000
);

test.skipIf(isWindows)(
  'breaking out of the stream() loop stops the process',
  async () => {
    const cmd = $({
      mirror: false,
    })`sh -c 'i=0; while true; do i=$((i+1)); echo b-$i; sleep 0.05; done'`;

    const start = Date.now();
    let count = 0;
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout') {
        count += 1;
        if (count >= 3) {
          break; // abandoning the iterator must terminate the process
        }
      }
    }
    const elapsed = Date.now() - start;

    expect(count).toBe(3);
    expect(elapsed).toBeLessThan(10000);
    // The finally block in stream() kills the still-running process on break.
    expect(cmd.finished).toBe(true);
  },
  20000
);

test.skipIf(isWindows)(
  'kill() honors the configured killSignal option (SIGINT => 130)',
  async () => {
    const cmd = $({
      mirror: false,
      killSignal: 'SIGINT',
    })`sh -c 'i=0; while true; do i=$((i+1)); echo s-$i; sleep 0.05; done'`;

    let count = 0;
    let exitChunk;
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout') {
        if (++count >= 3) {
          cmd.kill(); // no explicit signal -> uses the configured killSignal
        }
      } else if (chunk.type === 'exit') {
        exitChunk = chunk;
      }
    }

    expect(exitChunk).toBeDefined();
    // 128 + SIGINT(2) = 130
    expect(exitChunk.code).toBe(130);
    expect(cmd.finished).toBe(true);
  },
  20000
);

test.skipIf(isWindows)(
  'an explicit kill(signal) overrides the configured killSignal',
  async () => {
    const cmd = $({
      mirror: false,
      killSignal: 'SIGINT',
    })`sh -c 'i=0; while true; do i=$((i+1)); echo k-$i; sleep 0.05; done'`;

    let count = 0;
    let exitChunk;
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout') {
        if (++count >= 3) {
          cmd.kill('SIGKILL'); // explicit argument wins over the option
        }
      } else if (chunk.type === 'exit') {
        exitChunk = chunk;
      }
    }

    expect(exitChunk).toBeDefined();
    // 128 + SIGKILL(9) = 137
    expect(exitChunk.code).toBe(137);
  },
  20000
);

test.skipIf(isWindows)(
  'breaking out of the loop uses the configured killSignal',
  async () => {
    const cmd = $({
      mirror: false,
      killSignal: 'SIGINT',
    })`sh -c 'i=0; while true; do i=$((i+1)); echo br-$i; sleep 0.05; done'`;

    let count = 0;
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout' && ++count >= 3) {
        break; // iterator cleanup kills with the configured signal
      }
    }

    expect(cmd.finished).toBe(true);
    // The result the iterator finalizes with reflects the configured signal.
    const result = await cmd;
    expect(result.code).toBe(130);
  },
  20000
);

test.skipIf(isWindows)(
  'an external AbortSignal stops an awaited command and honors killSignal',
  async () => {
    // Regression: awaiting a long-running command while an external
    // AbortSignal fires used to hang forever because the abort listener was
    // only registered on the start({...}) path, not the await/then path.
    const ac = new AbortController();
    const running = $({
      mirror: false,
      signal: ac.signal,
      killSignal: 'SIGINT',
    })`sh -c 'i=0; while true; do echo a-$i; i=$((i+1)); sleep 0.05; done'`;

    const start = Date.now();
    setTimeout(() => ac.abort(), 200);
    const result = await running;
    const elapsed = Date.now() - start;

    // Resolves promptly rather than hanging, with the configured signal's code.
    expect(elapsed).toBeLessThan(10000);
    // 128 + SIGINT(2) = 130
    expect(result.code).toBe(130);
  },
  20000
);

test('exit chunk is yielded with zero added latency for normal commands', async () => {
  // The exit-pump grace only applies when a grandchild holds the pipe open;
  // an ordinary command must terminate the iterator immediately.
  const start = Date.now();
  const chunks = [];
  for await (const chunk of $({ mirror: false })`echo quick`.stream()) {
    chunks.push(chunk.type);
  }
  const elapsed = Date.now() - start;

  expect(chunks).toContain('exit');
  expect(elapsed).toBeLessThan(1000);
});
