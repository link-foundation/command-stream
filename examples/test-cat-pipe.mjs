#!/usr/bin/env bun

// Test with cat instead of jq

console.log('Test: Piping through cat (should not buffer)\n');

// First process: emulator
const proc1 = Bun.spawn(['./examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe',
});

// Second process: cat (should be unbuffered)
const proc2 = Bun.spawn(['cat'], {
  stdin: proc1.stdout,
  stdout: 'pipe',
  stderr: 'pipe',
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
