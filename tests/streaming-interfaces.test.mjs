import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../js/src/$.mjs';

// Platform detection - Some tests use Unix utilities (cat, grep, sort, sh)
const isWindows = process.platform === 'win32';

// Skip on Windows - uses 'cat' command
test.skipIf(isWindows)(
  'streaming interfaces - basic functionality',
  async () => {
    // Test streams.stdin with cat
    const catCmd = $`cat`;
    const stdin = await catCmd.streams.stdin;

    if (stdin) {
      stdin.write('Hello from streams.stdin!\n');
      stdin.write('Multiple lines work\n');
      stdin.end();
    }

    const result = await catCmd;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Hello from streams.stdin!');
    expect(result.stdout).toContain('Multiple lines work');
  }
);

test('streaming interfaces - auto-start behavior', async () => {
  const cmd = $`echo "test"`;

  // Accessing parent objects should not auto-start
  const streams = cmd.streams;
  const buffers = cmd.buffers;
  const strings = cmd.strings;
  expect(cmd.started).toBe(false);

  // Accessing actual properties should auto-start
  const stdout = cmd.streams.stdout;
  expect(cmd.started).toBe(true);

  await cmd;
});

// Skip on Windows - uses 'printf' command
test.skipIf(isWindows)('streaming interfaces - buffers interface', async () => {
  const cmd = $`printf "Binary test"`;
  const buffer = await cmd.buffers.stdout;

  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.toString()).toBe('Binary test');
});

test('streaming interfaces - strings interface', async () => {
  const cmd = $`echo "String test"`;
  const str = await cmd.strings.stdout;

  expect(typeof str).toBe('string');
  expect(str.trim()).toBe('String test');
});

// Skip on Windows - uses 'sh -c' command
test.skipIf(isWindows)(
  'streaming interfaces - mixed stdout/stderr',
  async () => {
    const cmd = $`sh -c 'echo "stdout" && echo "stderr" >&2'`;

    const [stdout, stderr] = await Promise.all([
      cmd.strings.stdout,
      cmd.strings.stderr,
    ]);

    expect(stdout.trim()).toBe('stdout');
    expect(stderr.trim()).toBe('stderr');
  }
);

// Skip on Windows - uses Unix signal exit codes (130, 143)
test.skipIf(isWindows)(
  'streaming interfaces - kill method works',
  async () => {
    const cmd = $`sleep 10`;

    // Start the process
    await cmd.streams.stdout;
    expect(cmd.started).toBe(true);

    // Kill after short delay
    setTimeout(() => cmd.kill(), 100);

    const result = await cmd;
    expect([130, 143, null]).toContain(result.code); // SIGTERM/SIGINT codes
  },
  5000
);

// Skip on Windows - uses 'cat' command (not available on Windows)
test.skipIf(isWindows)(
  'streaming interfaces - stdin control with cross-platform command',
  async () => {
    // Use 'cat' which works identically on all platforms and waits for input
    const catCmd = $`cat`;
    const stdin = await catCmd.streams.stdin;

    // Send some data and close stdin
    setTimeout(() => {
      if (stdin && !stdin.destroyed) {
        stdin.write('Hello from stdin!\n');
        stdin.write('Multiple lines work\n');
        setTimeout(() => stdin.end(), 100);
      }
    }, 100);

    // Backup kill (shouldn't be needed since we close stdin)
    setTimeout(() => {
      if (!catCmd.finished) {
        catCmd.kill();
      }
    }, 2000);

    const result = await catCmd;
    expect(typeof result.code).toBe('number');
    expect(result.code).toBe(0); // Should exit cleanly when stdin is closed
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain('Hello from stdin!');
    expect(result.stdout).toContain('Multiple lines work');
  },
  5000
);

test('streaming interfaces - immediate access after completion', async () => {
  const cmd = $`echo "immediate test"`;
  const result = await cmd;

  // After completion, should return immediate results
  const buffer = cmd.buffers.stdout;
  const string = cmd.strings.stdout;

  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(typeof string).toBe('string');
  expect(buffer.toString().trim()).toBe('immediate test');
  expect(string.trim()).toBe('immediate test');
});

test('streaming interfaces - backward compatibility', async () => {
  // Traditional await syntax should still work
  const result = await $`echo "backward compatible"`;
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('backward compatible');
});

// Skip on Windows - uses 'sort' command with different behavior
test.skipIf(isWindows)(
  'streaming interfaces - stdin pipe mode works',
  async () => {
    // Test that stdin: 'pipe' is properly handled vs string data
    const sortCmd = $`sort`;
    const stdin = await sortCmd.streams.stdin;

    expect(stdin).not.toBe(null);
    expect(typeof stdin.write).toBe('function');

    stdin.write('zebra\n');
    stdin.write('apple\n');
    stdin.write('banana\n');
    stdin.end();

    const result = await sortCmd;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('apple\nbanana\nzebra\n');
  }
);

// Skip on Windows - uses 'grep' command
test.skipIf(isWindows)(
  'streaming interfaces - grep filtering via stdin',
  async () => {
    const grepCmd = $`grep "important"`;
    const stdin = await grepCmd.streams.stdin;

    stdin.write('ignore this line\n');
    stdin.write('important message 1\n');
    stdin.write('skip this too\n');
    stdin.write('another important note\n');
    stdin.end();

    const result = await grepCmd;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('important message 1');
    expect(result.stdout).toContain('another important note');
    expect(result.stdout).not.toContain('ignore this');
    expect(result.stdout).not.toContain('skip this');
  }
);
