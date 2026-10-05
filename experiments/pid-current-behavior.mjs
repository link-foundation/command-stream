// Experiment: what does the current JS API expose about the child PID?
// Run: bun experiments/pid-current-behavior.mjs
import { $ } from '../js/src/$.mjs';

console.log('--- 1. before start ---');
const a = $`sleep 0.3`;
console.log('a.child            =', a.child);
console.log('a.pid              =', a.pid);

console.log('--- 2. after streams access (auto-start) ---');
await a.streams.stdout;
console.log('a.child?.pid       =', a.child?.pid);
console.log('a.pid              =', a.pid);

console.log('--- 3. after completion ---');
const result = await a;
console.log('exit code          =', result.code);
console.log('a.child            =', a.child);
console.log('a.pid              =', a.pid);
try {
  console.log('a.child.pid        =', a.child.pid);
} catch (e) {
  console.log('a.child.pid THROWS =', e.constructor.name + ': ' + e.message);
}

console.log('--- 4. plain await, never touched before finish ---');
const b = $`echo hi`;
await b;
console.log('b.child            =', b.child);
console.log('b.pid              =', b.pid);
