// Experiment: PID visibility for a real (non-virtual) external command.
import { $ } from '../js/src/$.mjs';

const a = $`/bin/sleep 0.5`; // absolute path bypasses the virtual `sleep`
const s = await a.streams.stdout;
console.log('child ctor   =', a.child?.constructor?.name ?? String(a.child));
console.log('child.pid    =', a.child?.pid);
console.log('stream       =', s ? s.constructor?.name : String(s));
const r = await a;
console.log('after await: child =', a.child, 'code =', r.code);

console.log('--- explicit start() ---');
const b = $`/bin/sleep 0.5`;
const started = b.start();
console.log('start() returns   =', started?.constructor?.name);
console.log('b.child?.pid      =', b.child?.pid);
await b;
console.log('after await: b.child =', b.child);
