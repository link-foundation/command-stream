import { $ } from '../src/$.mjs';

console.log('Testing exact timing of cancellation...');

// Patch the virtual command to see when it yields
const originalYes = (await import('../src/commands/$.yes.mjs')).default;
let yieldCount = 0;

const patchedYes = async function* (opts) {
  const gen = originalYes(opts);
  for await (const value of gen) {
    yieldCount++;
    console.log(`  [YES YIELD ${yieldCount}]`);
    yield value;
  }
};

// Temporarily replace yes command
const virtualCommands = (await import('../src/$.mjs')).virtualCommands;
virtualCommands.set('yes', patchedYes);

const runner = $`yes "test"`;
let iterations = 0;

console.log('\nStarting iteration...');
for await (const chunk of runner.stream()) {
  iterations++;
  console.log(`  [RECEIVED ${iterations}]: ${chunk.data.toString().trim()}`);

  if (iterations >= 3) {
    console.log('  [BREAKING]');
    break;
  }
}

console.log(`\nFinal:`);
console.log(`  Total yields from yes: ${yieldCount}`);
console.log(`  Total received: ${iterations}`);
console.log(`  runner.finished: ${runner.finished}`);

process.exit(0);
