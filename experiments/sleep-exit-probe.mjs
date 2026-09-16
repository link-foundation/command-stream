// Reproduces the hang caused by the `sleep` built-in: the interval it starts to
// poll for cancellation is never cleared when the sleep finishes normally, so
// the event loop stays alive and the host script never exits.
// Expected: "done" is printed and the process exits immediately.
import { $ } from '../src/$.mjs';

const started = Date.now();
await $({ mirror: false })`sleep 0.1`;
console.log(`done after ${Date.now() - started >= 90 ? 'the full delay' : 'too little time'}`);
console.log('if the process does not exit now, a timer was leaked');
