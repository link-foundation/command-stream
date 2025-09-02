import { test, expect } from 'bun:test';
import { $ } from '../src/$.mjs';

// TODO: fix later
// test('streaming interfaces - basic functionality', async () => {
//   // Test streams.stdin with cat
//   const catCmd = $`cat`;
//   const stdin = await catCmd.streams.stdin;
  
//   if (stdin) {
//     stdin.write('Hello from streams.stdin!\n');
//     stdin.write('Multiple lines work\n');
//     stdin.end();
//   }
  
//   const result = await catCmd;
//   expect(result.code).toBe(0);
//   expect(result.stdout).toContain('Hello from streams.stdin!');
//   expect(result.stdout).toContain('Multiple lines work');
// });

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

// TODO: fix later
// test('streaming interfaces - buffers interface', async () => {
//   const cmd = $`echo -n "Binary test"`;
//   const buffer = await cmd.buffers.stdout;
  
//   expect(Buffer.isBuffer(buffer)).toBe(true);
//   expect(buffer.toString()).toBe('Binary test');
// });

test('streaming interfaces - strings interface', async () => {
  const cmd = $`echo "String test"`;
  const str = await cmd.strings.stdout;
  
  expect(typeof str).toBe('string');
  expect(str.trim()).toBe('String test');
});

test('streaming interfaces - mixed stdout/stderr', async () => {
  const cmd = $`sh -c 'echo "stdout" && echo "stderr" >&2'`;
  
  const [stdout, stderr] = await Promise.all([
    cmd.strings.stdout,
    cmd.strings.stderr
  ]);
  
  expect(stdout.trim()).toBe('stdout');
  expect(stderr.trim()).toBe('stderr');
});

test('streaming interfaces - kill method works', async () => {
  const cmd = $`sleep 10`;
  
  // Start the process
  await cmd.streams.stdout;
  expect(cmd.started).toBe(true);
  
  // Kill after short delay
  setTimeout(() => cmd.kill(), 100);
  
  const result = await cmd;
  expect([130, 143, null]).toContain(result.code); // SIGTERM/SIGINT codes
}, 5000);

test('streaming interfaces - top with stdin control', async () => {
  const topCmd = $`top -l 2`; // Limited iterations on macOS
  const stdin = await topCmd.streams.stdin;
  
  // Try to quit early with 'q'
  setTimeout(() => {
    if (stdin && !stdin.destroyed) {
      stdin.write('q');
      setTimeout(() => stdin.end(), 100);
    }
  }, 500);
  
  // Backup kill
  setTimeout(() => {
    if (!topCmd.finished) {
      topCmd.kill();
    }
  }, 3000);
  
  const result = await topCmd;
  expect(typeof result.code).toBe('number');
  expect(result.stdout.length).toBeGreaterThan(0);
}, 5000);

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