#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Working Streaming Examples (without pipes) ===\n');

// Example 1: Simple streaming with delays (WORKS)
console.log('Example 1: Streaming with delays (no pipes):');
const startTime1 = Date.now();
const cmd1 = $`sh -c 'echo "First output"; sleep 0.5; echo "Second output"; sleep 0.5; echo "Third output"'`;

for await (const chunk of cmd1.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - startTime1;
    console.log(`[${elapsed}ms]`, chunk.data.toString().trim());
  }
}
console.log('✅ Streaming completed successfully\n');

// Example 2: Using .pipe() method instead of | syntax (WORKS)
console.log('Example 2: Using .pipe() method for JSON processing:');
const cmd2 = $`echo '{"message": "Hello from pipe method"}'`.pipe($`jq -c .`);
const result2 = await cmd2;
console.log('Result:', result2.stdout);
console.log('✅ Pipe method works\n');

// Example 3: EventEmitter pattern (WORKS without pipes)
console.log('Example 3: EventEmitter pattern without pipes:');
let eventCount = 0;

await new Promise((resolve) => {
  $`sh -c 'echo "Event 1"; sleep 0.3; echo "Event 2"; sleep 0.3; echo "Event 3"'`
    .on('data', (chunk) => {
      if (chunk.type === 'stdout') {
        eventCount++;
        console.log(`Event #${eventCount}:`, chunk.data.toString().trim());
      }
    })
    .on('end', (result) => {
      console.log('✅ EventEmitter completed. Exit code:', result.code);
      resolve();
    });
});

console.log('\n=== Known Issues ===');
console.log('⚠️  Pipe syntax (|) breaks streaming - see streaming-bug-report.md');
console.log('⚠️  Use .pipe() method or avoid pipes for realtime streaming');