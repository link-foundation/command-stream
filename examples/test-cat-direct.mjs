#!/usr/bin/env bun

console.log('=== Test cat | jq directly ===\n');

// Direct Bun test
const proc1 = Bun.spawn(['bun', 'run', 'examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe',
});

const proc2 = Bun.spawn(['cat'], {
  stdin: proc1.stdout,
  stdout: 'pipe',
  stderr: 'pipe',
});

const proc3 = Bun.spawn(['jq', '.'], {
  stdin: proc2.stdout,
  stdout: 'pipe',
  stderr: 'pipe',
});

const start = Date.now();
let chunkCount = 0;

console.log('Reading from jq output:');
for await (const chunk of proc3.stdout) {
  chunkCount++;
  const elapsed = Date.now() - start;
  console.log(`[${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes`);
}

await proc1.exited;
await proc2.exited;
await proc3.exited;

console.log(`\nTotal chunks: ${chunkCount}`);
console.log(chunkCount === 1 ? '❌ Buffered' : '✅ Streaming');
