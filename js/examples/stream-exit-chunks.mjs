#!/usr/bin/env node
// Demonstrates issue #155 fixes for the stream() async iterator:
//   1. stream() yields a final { type: 'exit', code } chunk on process exit.
//   2. stream() (and awaiting a command) no longer hangs when the process has
//      exited but a grandchild keeps the stdout pipe open.
import { $ } from '../src/$.mjs';

// 1. Observe the exit code from within the async iterator.
console.log('--- exit chunk ---');
for await (const chunk of $({
  mirror: false,
})`sh -c 'echo hello; exit 3'`.stream()) {
  if (chunk.type === 'exit') {
    console.log('exit chunk, code =', chunk.code);
  } else {
    console.log(chunk.type, '=>', chunk.data.toString().trim());
  }
}

// 2. The backgrounded `sleep` inherits stdout and keeps it open, but the
//    iterator still terminates promptly once `sh` itself exits.
console.log('--- no hang with a lingering grandchild ---');
const start = Date.now();
for await (const chunk of $({
  mirror: false,
})`sh -c 'sleep 30 & echo done'`.stream()) {
  if (chunk.type === 'exit') {
    console.log(`finished in ${Date.now() - start}ms with code ${chunk.code}`);
  } else {
    console.log(chunk.type, '=>', chunk.data.toString().trim());
  }
}

// 3. Stop a long-running command from inside the loop by calling kill().
console.log('--- stop from inside the loop ---');
const endless = $({
  mirror: false,
})`sh -c 'i=0; while true; do i=$((i+1)); echo tick-$i; sleep 0.1; done'`;
let ticks = 0;
for await (const chunk of endless.stream()) {
  if (chunk.type === 'stdout') {
    console.log('stdout =>', chunk.data.toString().trim());
    if (++ticks >= 3) {
      endless.kill(); // ends the loop with an exit chunk
    }
  } else if (chunk.type === 'exit') {
    console.log('stopped with code', chunk.code);
  }
}
