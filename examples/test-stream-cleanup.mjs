import { $ } from '../js/src/$.mjs';

console.log('Testing stream cleanup...');

// Test that breaking from iteration kills the process
let count = 0;
const startTime = Date.now();

for await (const chunk of $`yes "test output"`.stream()) {
  console.log(`Chunk ${++count}: ${chunk.data.toString().trim()}`);
  if (count >= 3) {
    console.log('Breaking from iteration...');
    break;
  }
}

// Wait a bit to see if process continues outputting
await new Promise((resolve) => setTimeout(resolve, 100));

console.log(`Test completed in ${Date.now() - startTime}ms`);
console.log('If you see this message quickly without hanging, cleanup worked!');

// Test with another command to ensure no interference
const result = await $`echo "clean test"`;
console.log('Next command output:', result.stdout.trim());

console.log('✅ Stream cleanup test passed!');
