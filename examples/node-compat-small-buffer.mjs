#!/usr/bin/env bun

// Reading with small buffer size

import { spawn } from 'child_process';

console.log('Reading with small buffer size:');

const start = Date.now();
let chunkCount = 0;

const proc1 = spawn('bun', ['run', 'examples/emulate-claude-stream.mjs']);
const proc2 = spawn('jq', ['.'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

proc1.stdout.pipe(proc2.stdin);

// Try to read in smaller chunks
proc2.stdout.on('readable', () => {
  let chunk;
  while (null !== (chunk = proc2.stdout.read(1))) {
    // Read 1 byte at a time
    chunkCount++;
    const elapsed = Date.now() - start;
    if (chunkCount === 1 || chunkCount % 100 === 0) {
      console.log(`[${elapsed}ms] Byte ${chunkCount}: ${chunk.toString()}`);
    }
  }
});

await new Promise((resolve) => proc2.on('exit', resolve));
console.log(`Total bytes read: ${chunkCount}`);
