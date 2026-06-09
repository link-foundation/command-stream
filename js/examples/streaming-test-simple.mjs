#!/usr/bin/env node

/**
 * Simple streaming test to verify command-stream functionality
 * Uses 'echo' and 'seq' commands that are guaranteed to exist
 */

import { $ } from '../src/$.mjs';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

console.log('🧪 Testing streaming with simple commands...\n');

// Test 1: Basic echo with streaming
console.log('Test 1: Basic echo streaming');
let chunkCount = 0;

const echoTest = $`echo "Hello from streaming test!"`;
echoTest
  .on('data', (chunk) => {
    chunkCount++;
    console.log(`📦 Chunk ${chunkCount}: "${chunk.data.toString().trim()}"`);
  })
  .on('end', (result) => {
    console.log(
      `✅ Echo test complete. Chunks: ${chunkCount}, Exit code: ${result.code}\n`
    );

    // Test 2: seq command for multiple chunks
    runSeqTest();
  });

await echoTest.start();

function runSeqTest() {
  console.log('Test 2: Sequence streaming (multiple chunks)');
  let seqChunks = 0;

  const seqTest = $`seq 1 5`;
  seqTest
    .on('data', (chunk) => {
      seqChunks++;
      const data = chunk.data.toString().trim();
      console.log(`📦 Seq chunk ${seqChunks}: "${data}"`);
    })
    .on('end', (result) => {
      console.log(
        `✅ Seq test complete. Chunks: ${seqChunks}, Exit code: ${result.code}\n`
      );

      // Test 3: For-await streaming pattern
      runAsyncIteratorTest();
    });

  seqTest.start();
}

async function runAsyncIteratorTest() {
  console.log('Test 3: Async iterator streaming pattern');
  let iteratorChunks = 0;

  for await (const chunk of $`seq 10 13`.stream()) {
    iteratorChunks++;
    console.log(
      `🔄 Iterator chunk ${iteratorChunks}: "${chunk.data.toString().trim()}" (${chunk.type})`
    );
  }

  console.log(`✅ Async iterator test complete. Chunks: ${iteratorChunks}\n`);
  console.log('🎉 All streaming tests completed!');
}
