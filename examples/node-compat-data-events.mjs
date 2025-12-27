#!/usr/bin/env bun

// Node.js spawn with on("data") events

import { spawn } from 'child_process';

console.log('Node.js spawn with on("data") events:');

const start = Date.now();
let chunkCount = 0;

const proc1 = spawn('bun', ['run', 'examples/emulate-claude-stream.mjs']);
const proc2 = spawn('jq', ['.'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Pipe proc1 to proc2
proc1.stdout.pipe(proc2.stdin);

// Listen for data events
proc2.stdout.on('data', (chunk) => {
  chunkCount++;
  const elapsed = Date.now() - start;
  const text = chunk.toString();
  const lines = text
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 2);
  console.log(
    `[${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes, first lines:`,
    lines
  );
});

await new Promise((resolve) => proc2.on('exit', resolve));
console.log(`Total chunks: ${chunkCount}`);
