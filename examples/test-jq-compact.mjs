#!/usr/bin/env bun

// Test jq with compact output mode

console.log('Test: jq with -c (compact) flag\n');

const proc1 = Bun.spawn(['./examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe'
});

// Use jq -c for compact output (one line per JSON object)
const proc2 = Bun.spawn(['jq', '-c', '.'], {
  stdin: proc1.stdout,
  stdout: 'pipe',
  stderr: 'pipe'
});

const start = Date.now();
let chunkCount = 0;

for await (const chunk of proc2.stdout) {
  chunkCount++;
  const elapsed = Date.now() - start;
  const text = Buffer.from(chunk).toString().trim();
  
  console.log(`[${elapsed}ms] Chunk ${chunkCount}: ${text}`);
}

console.log(`\nTotal chunks received: ${chunkCount}`);

await proc1.exited;
await proc2.exited;