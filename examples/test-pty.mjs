#!/usr/bin/env bun

// Test using unbuffer or script to create a pseudo-TTY

console.log('Test: Using unbuffer to force line buffering\n');

const proc1 = Bun.spawn(['./examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe'
});

// Try using unbuffer (if available) to force line buffering
// unbuffer is part of the expect package
const proc2 = Bun.spawn(['unbuffer', 'jq', '.'], {
  stdin: proc1.stdout,
  stdout: 'pipe',
  stderr: 'pipe'
});

const start = Date.now();
let chunkCount = 0;

for await (const chunk of proc2.stdout) {
  chunkCount++;
  const elapsed = Date.now() - start;
  const text = Buffer.from(chunk).toString();
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 2);
  
  console.log(`[${elapsed}ms] Chunk ${chunkCount}: First lines:`, lines);
}

console.log(`\nTotal chunks received: ${chunkCount}`);

await proc1.exited;
await proc2.exited;