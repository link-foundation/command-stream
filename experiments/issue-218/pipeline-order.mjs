// Concurrent producers preserve their own order, not a timer-derived merge.
import assert from 'node:assert/strict';
import { $ } from '../../js/src/zx/core.mjs';

const run = $({ quiet: true, timeout: 5000 });
const halted = run({ halt: true });
const p1 = run`echo foo`;
const p2 = halted`echo a && sleep 0.2 && echo c && sleep 0.4 && echo e`;
// Model a producer that cannot run until the other has already emitted c.
const p3 = halted`read -r next && echo b && sleep 0.2 && echo d`;
const p4 = run`sleep 1.5 && echo bar`;
const p5 = halted`cat`;
await p1;
p1.pipe(p5);
p2.pipe(p5);
p3.pipe(p5);
p4.pipe(p5);
let observed = '';
let released = false;
p2.stdout.on('data', (chunk) => {
  observed += chunk.toString();
  if (!released && observed.includes('c\n')) {
    released = true;
    p3.write('next\n');
  }
});
const { stdout } = await p5.run();
assert.notEqual(stdout, 'foo\na\nb\nc\nd\ne\nbar\n');
assert.deepEqual(stdout.trim().split('\n').sort(), [
  'a',
  'b',
  'bar',
  'c',
  'd',
  'e',
  'foo',
]);
console.log(`Delayed producer: ${JSON.stringify(stdout)}`);
