#!/usr/bin/env node
/**
 * Async Iteration Pattern: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates real-time streaming with async iteration
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function asyncIterationComparison() {
  try {
    console.log('1️⃣  Real-time Streaming with Built-in Commands:');
    let chunkCount = 0;
    
    for await (const chunk of $`seq 1 5`.stream()) {
      if (chunk.type === 'stdout') {
        chunkCount++;
        console.log(`   Chunk ${chunkCount}: ${chunk.data.toString().trim()}`);
      }
    }

    console.log('\n2️⃣  Streaming with System Commands:');
    let eventCount = 0;
    
    // Use a command that produces output with delays
    for await (const chunk of $`sh -c 'for i in A B C; do echo "Event $i"; sleep 0.1; done'`.stream()) {
      if (chunk.type === 'stdout') {
        eventCount++;
        console.log(`   ${runtime} Event ${eventCount}: ${chunk.data.toString().trim()}`);
      }
    }

    console.log('\n3️⃣  Pipeline Streaming:');
    let pipelineEvents = 0;
    
    for await (const chunk of $`echo -e "red\ngreen\nblue" | cat`.stream()) {
      if (chunk.type === 'stdout') {
        pipelineEvents++;
        console.log(`   Pipeline ${pipelineEvents}: ${chunk.data.toString().trim()}`);
      }
    }

    console.log('\n4️⃣  Mixed Streaming (stdout + stderr):');
    let mixedCount = 0;
    
    for await (const chunk of $`sh -c 'echo "stdout message"; echo "stderr message" >&2'`.stream()) {
      mixedCount++;
      console.log(`   ${chunk.type.toUpperCase()}: ${chunk.data.toString().trim()}`);
    }

    console.log('\n5️⃣  Large Output Streaming:');
    let largeCount = 0;
    
    for await (const chunk of $`seq 1 10`.stream()) {
      if (chunk.type === 'stdout') {
        largeCount++;
      }
    }
    console.log(`   Processed ${largeCount} chunks from large output`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All async iteration patterns work perfectly in ${runtime}!`);
    console.log(`   Total chunks processed: ${chunkCount + eventCount + pipelineEvents + mixedCount + largeCount}`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    process.exit(1);
  }
}

asyncIterationComparison();