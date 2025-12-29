import { $ } from '../js/src/$.mjs';

console.log('Starting test...');

const cmd = $`yes x`;
let count = 0;

// Track when we start iterating
console.log('Starting iteration...');

for await (const chunk of cmd.stream()) {
  count++;
  console.log(`Got chunk ${count}`);

  if (count >= 2) {
    console.log('Breaking now...');
    break;
  }
}

console.log('After break');
console.log('Finished:', cmd.finished);
console.log('Cancelled:', cmd._cancelled);

process.exit(0);
