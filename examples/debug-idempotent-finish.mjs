#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Idempotent Finish Method Test ===');

// Test that finish() is now idempotent (safe to call multiple times)
const runner = $`echo "test"`;

let eventCount = 0;
let endEventCount = 0;
let exitEventCount = 0;

runner.on('end', (result) => {
  endEventCount++;
  console.log(`End event #${endEventCount}, result: ${result.stdout.trim()}`);
});

runner.on('exit', (code) => {
  exitEventCount++;
  console.log(`Exit event #${exitEventCount}, code: ${code}`);
});

runner.on('data', () => {
  eventCount++;
});

// Start and await the process
await runner;

console.log(`\nAfter normal completion:`);
console.log(`- finished: ${runner.finished}`);
console.log(`- result: ${runner.result.stdout.trim()}`);
console.log(`- end events: ${endEventCount}`);
console.log(`- exit events: ${exitEventCount}`);

// Now try to finish again (should be idempotent)
console.log(`\nTrying to finish again (should be safe now)...`);

const result2 = runner.finish({
  code: 0,
  stdout: 'different output',
  stderr: '',
  stdin: ''
});

console.log(`\nAfter second finish() call:`);
console.log(`- finished: ${runner.finished}`);
console.log(`- result: ${runner.result.stdout.trim()} (should be original)`);
console.log(`- returned result: ${result2.stdout.trim()} (should be original)`);
console.log(`- end events: ${endEventCount} (should still be 1)`);
console.log(`- exit events: ${exitEventCount} (should still be 1)`);

console.log('\nIdempotent finish test completed!');