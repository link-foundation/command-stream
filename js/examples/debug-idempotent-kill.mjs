#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Idempotent Kill Test ===');

// Test that kill now works without conditional checks
const runner = $`sleep 1`;

let endEventCount = 0;
let exitEventCount = 0;

runner.on('end', (result) => {
  endEventCount++;
  console.log(
    `End event #${endEventCount}, code: ${result.code}, stderr: ${result.stderr.trim()}`
  );
});

runner.on('exit', (code) => {
  exitEventCount++;
  console.log(`Exit event #${exitEventCount}, code: ${code}`);
});

const promise = runner.start();

// Give it a moment to start
await new Promise((resolve) => setTimeout(resolve, 50));

console.log('Killing process...');
runner.kill('SIGTERM');

try {
  await promise;
} catch (error) {
  console.log(`Expected error: ${error.message}`);
}

console.log(`\nAfter kill:`);
console.log(`- finished: ${runner.finished}`);
console.log(`- result code: ${runner.result.code}`);
console.log(`- result stderr: ${runner.result.stderr.trim()}`);
console.log(`- end events: ${endEventCount}`);
console.log(`- exit events: ${exitEventCount}`);

// Try to kill again (should be safe due to idempotent finish)
console.log('\nTrying to kill again (should be safe)...');
runner.kill('SIGKILL');

console.log(`\nAfter second kill:`);
console.log(`- finished: ${runner.finished}`);
console.log(
  `- result code: ${runner.result.code} (should still be 143 for SIGTERM)`
);
console.log(`- end events: ${endEventCount} (should still be 1)`);
console.log(`- exit events: ${exitEventCount} (should still be 1)`);

console.log('\nIdempotent kill test completed!');
