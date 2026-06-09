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
