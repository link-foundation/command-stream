// Experiment: verify the new `pid` getter across every execution path.
import { $ } from '../js/src/$.mjs';

const show = (label, v) => console.log(label.padEnd(34), v);

// 1. real async command
const a = $`/bin/sleep 0.4`;
await a.streams.stdout;
const live = a.pid;
show('async, while running', live);
await a;
show('async, after completion', a.pid);
show('async, pid stable', a.pid === live);

// 2. plain await, never inspected mid-flight
const b = $`/bin/echo hi`;
await b;
show('plain await', b.pid);

// 3. virtual command (runs in-process, no child)
const c = $`echo hi`;
await c;
show('virtual command', c.pid);

// 4. before start
const d = $`/bin/true`;
show('before start', d.pid);
await d;

// 5. sync mode
const e = $`/bin/echo sync`;
e.sync();
show('sync mode', e.pid);

// 6. streaming iteration
const f = $`/bin/sh -c 'echo one; echo two'`;
let seen;
for await (const chunk of f.stream()) {
  seen ??= f.pid;
  void chunk;
}
show('during stream()', seen);
show('after stream()', f.pid);
