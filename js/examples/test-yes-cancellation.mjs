import { $ } from '../src/$.mjs';

console.log('Testing yes command cancellation...');

const runner = $`yes "test output"`;
let iterations = 0;
const maxIterations = 5;

console.log('Starting async iteration...');
for await (const chunk of runner.stream()) {
  iterations++;
  console.log(`Iteration ${iterations}: received chunk`);
  if (iterations >= maxIterations) {
    console.log('Breaking from loop...');
    break; // This MUST stop the yes command
  }
}

console.log(`Finished: ${runner.finished}`);
console.log(`Total iterations: ${iterations}`);

// Wait a bit to ensure no more output
await new Promise((resolve) => setTimeout(resolve, 100));

console.log('Test complete');
process.exit(0);
