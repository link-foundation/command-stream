import { $ } from '../src/$.mjs';

console.log('Testing yes command stopping...');

const runner = $({ mirror: false })`yes "test"`;
let iterations = 0;

console.log('Starting iteration...');
for await (const chunk of runner.stream()) {
  iterations++;
  console.log(`Iteration ${iterations}`);
  
  if (iterations >= 3) {
    console.log('Breaking...');
    break;
  }
}

console.log(`Finished: ${runner.finished}`);
console.log(`Total iterations: ${iterations}`);

// Check if the runner is actually stopped
console.log('\nWaiting 100ms...');
await new Promise(resolve => setTimeout(resolve, 100));

console.log('Still finished:', runner.finished);

process.exit(0);