import { $ } from '../$.mjs';

console.log('Testing stream cleanup...');

let count = 0;
for await (const chunk of $`yes x`.stream()) {
  count++;
  console.log(`Chunk ${count}`);
  if (count >= 3) {
    console.log('Breaking...');
    break;
  }
}

console.log('After break');

// Small delay to see if output continues
await new Promise(r => setTimeout(r, 100));

console.log('Done');
process.exit(0);