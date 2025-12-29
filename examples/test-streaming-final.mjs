#!/usr/bin/env bun

import { $ } from '../js/src/$.mjs';

console.log('=== Final Real-Time Streaming Test ===\n');

console.log('Test 1: Simple command streaming (baseline):');
{
  const start = Date.now();
  for await (const chunk of $`bun run examples/emulate-claude-stream.mjs`.stream()) {
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

console.log('\nTest 2: With jq pipeline (using PTY for real-time streaming):');
{
  const start = Date.now();
  let chunkCount = 0;

  // Use a real command instead of virtual echo
  for await (const chunk of $`bun run examples/emulate-claude-stream.mjs | jq .`.stream()) {
    if (chunk.type === 'stdout') {
      chunkCount++;
      const elapsed = Date.now() - start;
      const text = chunk.data.toString();
      const lines = text.split('\n').filter((l) => l.trim());

      console.log(
        `  [${elapsed}ms] Chunk ${chunkCount}: ${lines.length} lines`
      );
      if (lines.length > 0 && chunkCount <= 3) {
        console.log(`    First line: ${lines[0]}`);
      }
    }
  }
  console.log(`  Total chunks: ${chunkCount}`);
  console.log(
    '  ✅ If you see multiple chunks at different times, streaming works!'
  );
}

console.log('\nTest 3: Printf with jq (no virtual commands):');
{
  const start = Date.now();

  const result = await $`printf '{"x":1}\\n{"x":2}\\n' | jq .`;
  console.log(`  Result received at [${Date.now() - start}ms]`);
  console.log('  Output:', result.stdout.trim());
}
