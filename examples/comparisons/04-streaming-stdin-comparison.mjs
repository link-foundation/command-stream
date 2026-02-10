#!/usr/bin/env node
/**
 * Streaming STDIN Control: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates real-time stdin control and streaming interfaces
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function streamingStdinComparison() {
  try {
    console.log('1️⃣  Basic STDIN Control:');
    
    const catCmd = $`cat`;
    
    // Start the command
    catCmd.start();
    
    // Wait a moment for process to spawn
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Access stdin stream
    const stdin = await catCmd.streams.stdin;
    if (stdin) {
      stdin.write(`Hello from ${runtime}!\n`);
      stdin.write('Multiple lines work perfectly!\n');
      stdin.end();
    }
    
    const result = await catCmd;
    console.log(`   Output: ${result.stdout.trim()}`);

    console.log('\n2️⃣  Interactive Command Control:');
    
    const grepCmd = $`grep "important"`;
    const grepStdin = await grepCmd.streams.stdin;
    
    if (grepStdin) {
      grepStdin.write('ignore this line\n');
      grepStdin.write('important message here\n');
      grepStdin.write('skip this too\n');
      grepStdin.write('another important note\n');
      grepStdin.end();
    }
    
    const grepResult = await grepCmd;
    console.log(`   Filtered output:\n${grepResult.stdout}`);

    console.log('\n3️⃣  Sort Command with STDIN:');
    
    const sortCmd = $`sort -r`;
    const sortStdin = await sortCmd.streams.stdin;
    
    if (sortStdin) {
      sortStdin.write('zebra\n');
      sortStdin.write('apple\n');
      sortStdin.write('banana\n');
      sortStdin.end();
    }
    
    const sortResult = await sortCmd;
    console.log(`   Sorted (reverse): ${sortResult.stdout.trim()}`);

    console.log('\n4️⃣  Pipeline with STDIN:');
    
    const pipelineCmd = $`cat | wc -l`;
    const pipelineStdin = await pipelineCmd.streams.stdin;
    
    if (pipelineStdin) {
      pipelineStdin.write('line 1\n');
      pipelineStdin.write('line 2\n');
      pipelineStdin.write('line 3\n');
      pipelineStdin.end();
    }
    
    const pipelineResult = await pipelineCmd;
    console.log(`   Line count: ${pipelineResult.stdout.trim()}`);

    console.log('\n5️⃣  Options-based STDIN:');
    
    const optionsCmd = $({ stdin: `Data from ${runtime} options\nSecond line\n` })`cat`;
    const optionsResult = await optionsCmd;
    console.log(`   Options STDIN:\n${optionsResult.stdout}`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All streaming STDIN patterns work perfectly in ${runtime}!`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

streamingStdinComparison();