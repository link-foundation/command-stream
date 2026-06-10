#!/usr/bin/env bun

import { $, register } from '../src/$.mjs';

console.log('=== Comprehensive Streaming Behavior Test ===\n');
console.log(
  'This test demonstrates streaming behavior in different scenarios.\n'
);

// Register a streaming virtual command
register('delay-echo', async function* (args) {
  const items = args[0] ? args[0].split(',') : ['1', '2', '3'];
  const delay = parseInt(args[1] || '300');

  for (let i = 0; i < items.length; i++) {
    yield `${items[i]}\n`;
    if (i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
});

async function runTest(name, command, description) {
  console.log(`\n${name}`);
  console.log(`${description}`);
  console.log('Expected: Output appears incrementally');
  console.log('Actual:');

  const start = Date.now();
  const chunks = [];

  for await (const chunk of command.stream()) {
    if (chunk.type === 'stdout') {
      const elapsed = Date.now() - start;
      const lines = chunk.data
        .toString()
        .trim()
        .split('\n')
        .filter((l) => l);
      for (const line of lines) {
        chunks.push({ time: elapsed, data: line });
        console.log(`  [${elapsed}ms] ${line}`);
      }
    }
  }

  // Analyze streaming behavior
  if (chunks.length > 1) {
    const firstTime = chunks[0].time;
    const lastTime = chunks[chunks.length - 1].time;
    const spread = lastTime - firstTime;

    if (spread < 100) {
      console.log('  ❌ All output arrived at once (buffered)');
    } else {
      console.log('  ✅ Output streamed incrementally');
    }
  }
}

// Test cases
console.log('='.repeat(60));

await runTest(
  'Test 1: Shell command without pipe',
  $`sh -c 'echo "A"; sleep 0.3; echo "B"; sleep 0.3; echo "C"'`,
  'Direct shell execution should stream line by line'
);

await runTest(
  'Test 2: Virtual command without pipe',
  $`delay-echo A,B,C 300`,
  'Virtual commands should stream incrementally'
);

await runTest(
  'Test 3: Shell piped to cat',
  $`sh -c 'echo "A"; sleep 0.3; echo "B"; sleep 0.3; echo "C"' | cat`,
  'Pipe to cat may buffer (depends on system)'
);

await runTest(
  'Test 4: Virtual piped to cat',
  $`delay-echo X,Y,Z 300 | cat`,
  'Virtual command through pipe may buffer'
);

await runTest(
  'Test 5: Shell piped to virtual pass-through',
  $`sh -c 'echo "1"; sleep 0.3; echo "2"; sleep 0.3; echo "3"' | delay-echo`,
  'Real to virtual pipeline'
);

// Register a pass-through virtual command
register('passthrough', async function* ({ args, stdin }) {
  if (stdin) {
    yield stdin;
  }
});

await runTest(
  'Test 6: Virtual to virtual pipeline',
  $`delay-echo P,Q,R 300 | passthrough`,
  'Virtual to virtual should maintain streaming if properly implemented'
);

console.log(`\n${'='.repeat(60)}`);
console.log('\nSummary:');
console.log('- Direct command execution (no pipes) streams properly');
console.log('- Pipes may introduce buffering depending on the commands');
console.log('- Virtual commands can stream when used alone');
console.log('- Mixed pipelines depend on how data flows between stages');
console.log('\nTo achieve true streaming through pipes, commands need to:');
console.log('1. Flush output after each line');
console.log('2. Use line-buffered or unbuffered mode');
console.log('3. Or be specifically designed for streaming');
