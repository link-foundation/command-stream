import { $ } from '../src/$.mjs';

console.log('Testing buffer behavior in stream()...');

const runner = $`yes "test"`;
let iterations = 0;

// Override emit to see when data events are fired
const originalEmit = runner.emit.bind(runner);
let dataEventCount = 0;
runner.emit = function (event, ...args) {
  if (event === 'data') {
    dataEventCount++;
    console.log(`  [DATA EVENT ${dataEventCount}] emitted`);
  }
  return originalEmit(event, ...args);
};

console.log('\nStarting iteration...');
for await (const chunk of runner.stream()) {
  iterations++;
  console.log(`Iteration ${iterations}: received chunk`);

  if (iterations >= 3) {
    console.log('Breaking after iteration 3...');
    break;
  }
}

console.log(`\nFinal state:`);
console.log(`  iterations: ${iterations}`);
console.log(`  dataEventCount: ${dataEventCount}`);
console.log(`  runner.finished: ${runner.finished}`);

await new Promise((resolve) => setTimeout(resolve, 100));
console.log(`\nAfter 100ms:`);
console.log(`  dataEventCount: ${dataEventCount}`);

process.exit(0);
