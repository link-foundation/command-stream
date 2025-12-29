#!/usr/bin/env bun

import { $ } from '../js/src/$.mjs';

console.log('=== Final Streaming Test with PTY Workaround ===\n');

console.log('Test 1: Direct emulator execution (baseline):');
{
  const start = Date.now();
  for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs`.stream()) {
    if (chunk.type === 'stdout') {
      const elapsed = Date.now() - start;
      const lines = chunk.data
        .toString()
        .trim()
        .split('\n')
        .filter((l) => l);
      for (const line of lines) {
        console.log(`  [${elapsed}ms] ${line}`);
      }
    }
  }
}

console.log(
  '\nTest 2: Emulator piped through jq (should stream in real-time):'
);
{
  const start = Date.now();
  let chunkCount = 0;

  for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs | jq .`.stream()) {
    if (chunk.type === 'stdout') {
      chunkCount++;
      const elapsed = Date.now() - start;
      const text = chunk.data.toString();
      const lines = text.split('\n').filter((l) => l.trim());

      if (lines.length > 0) {
        console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${lines[0]}`);
        if (lines.length > 1) {
          console.log(
            `                    ... and ${lines.length - 1} more lines`
          );
        }
      }
    }
  }
  console.log(`  Total chunks: ${chunkCount}`);
}

console.log('\nTest 3: Complex pipeline with jq -c:');
{
  const start = Date.now();

  for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs | jq -c .`.stream()) {
    if (chunk.type === 'stdout') {
      const elapsed = Date.now() - start;
      const lines = chunk.data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) {
          console.log(`  [${elapsed}ms] ${line}`);
        }
      }
    }
  }
}

console.log(
  '\n✅ If timestamps show incremental times (not all the same), streaming is working!'
);
