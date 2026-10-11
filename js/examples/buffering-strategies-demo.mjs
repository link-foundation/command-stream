import { command, stream } from '../src/$.mjs';

console.log('Size batches:', await stream([1, 2, 3, 4, 5]).batch(2).toArray());
console.log(
  'Sliding windows:',
  await stream([1, 2, 3, 4]).slidingWindow(3).toArray()
);

// The 50 ms deadline flushes a partial batch during the pause in output.
const logs = command(
  process.execPath,
  '-e',
  `
  console.log('INFO started');
  await new Promise(resolve => setTimeout(resolve, 150));
  console.log('ERROR timeout');
  console.log('INFO recovered');
`
).with({ capture: false, mirror: false });
await logs
  .stream()
  .batch(10, 50)
  .forEach(async (batch) => {
    console.log({
      logs: batch.length,
      errors: batch.filter((line) => line.startsWith('ERROR')).length,
    });
  });

console.log(
  'Transformed batches:',
  await stream([1, 2, 3, 4, 5, 6])
    .map(async (value) => value * 2)
    .filter((value) => value > 6)
    .batch(2)
    .toArray()
);
