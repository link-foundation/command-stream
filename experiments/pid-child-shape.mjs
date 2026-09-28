// Experiment: inspect the child object shape while the process is alive.
import { $ } from '../js/src/$.mjs';

const a = $`sleep 0.5`;
const s = await a.streams.stdout;
console.log(
  'typeof a.child     =',
  typeof a.child,
  a.child === null ? '(null)' : ''
);
if (a.child) {
  console.log('constructor        =', a.child.constructor?.name);
  console.log('pid                =', a.child.pid);
  console.log('own keys           =', Object.keys(a.child).slice(0, 30));
}
console.log('stream obtained    =', s ? s.constructor?.name : s);
await a;
