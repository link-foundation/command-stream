#!/usr/bin/env bun

// Test spawning jq directly without sh -c

console.log('Test: Spawn processes directly and pipe them\n');

// First process: emulator
const proc1 = Bun.spawn(['./js/examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe',
});

// Second process: jq with stdin from first process
const proc2 = Bun.spawn(['jq', '.'], {
  stdin: proc1.stdout,
  stdout: 'pipe',
  stderr: 'pipe',
});

const start = Date.now();
let chunkCount = 0;

for await (const chunk of proc2.stdout) {
  chunkCount++;
  const elapsed = Date.now() - start;
  const text = Buffer.from(chunk).toString();
  const lines = text.split('\n').filter((l) => l.trim());

  if (chunkCount === 1) {
    console.log(
      `[${elapsed}ms] First chunk arrived with ${lines.length} lines`
    );
    console.log('First few lines:', lines.slice(0, 3));
  } else {
    console.log(
      `[${elapsed}ms] Chunk ${chunkCount} with ${lines.length} lines`
    );
  }
}

console.log(`\nTotal chunks received: ${chunkCount}`);
console.log(
  'If streaming worked, we should see multiple chunks at different times'
);

await proc1.exited;
await proc2.exited;
