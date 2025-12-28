#!/usr/bin/env bun

// Using readable event

import { spawn } from 'child_process';

console.log('Using readable event:');

const start = Date.now();
let chunkCount = 0;

const proc1 = spawn('bun', ['run', 'examples/emulate-claude-stream.mjs']);
const proc2 = spawn('jq', ['.'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

proc1.stdout.pipe(proc2.stdin);

proc2.stdout.on('readable', () => {
  let chunk;
  while (null !== (chunk = proc2.stdout.read())) {
    chunkCount++;
    const elapsed = Date.now() - start;
    console.log(`[${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes`);
  }
});

await new Promise((resolve) => proc2.on('exit', resolve));
console.log(`Total chunks: ${chunkCount}`);
