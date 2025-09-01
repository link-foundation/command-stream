import { $ } from '../src/$.mjs';

console.log('Testing yes command cancellation in detail...');

// Test 1: Direct generator usage
console.log('\n=== Test 1: Direct generator test ===');
import yesCommand from '../src/commands/$.yes.mjs';

let cancelled = false;
const abortController = new AbortController();
const generator = yesCommand({ 
  args: ['test'], 
  stdin: '', 
  isCancelled: () => cancelled,
  signal: abortController.signal
});

let count = 0;
for await (const chunk of generator) {
  count++;
  console.log(`Direct iteration ${count}: ${chunk.trim()}`);
  if (count >= 3) {
    console.log('Setting cancelled=true and aborting...');
    cancelled = true;
    abortController.abort();
    // Try to return the generator
    if (generator.return) {
      await generator.return();
    }
    break;
  }
}
console.log(`Direct test finished, count=${count}`);

// Test 2: Through command-stream
console.log('\n=== Test 2: Through command-stream ===');
const runner = $`yes "stream test"`;
let iterations = 0;

for await (const chunk of runner.stream()) {
  iterations++;
  console.log(`Stream iteration ${iterations}: got chunk`);
  if (iterations >= 3) {
    console.log('Breaking from stream...');
    break;
  }
}

console.log(`Stream test finished: runner.finished=${runner.finished}, iterations=${iterations}`);

// Wait to see if any more output comes
console.log('\nWaiting 500ms to check for spurious output...');
await new Promise(resolve => setTimeout(resolve, 500));

console.log('All tests complete');
process.exit(0);