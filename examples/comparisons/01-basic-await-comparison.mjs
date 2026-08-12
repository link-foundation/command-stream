#!/usr/bin/env node
/**
 * Basic Await Pattern: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates the classic await pattern working 
 * identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function basicAwaitComparison() {
  try {
    console.log('1️⃣  Basic Command Execution:');
    const result1 = await $`echo "Hello from ${runtime}!"`;
    console.log(`   Output: ${result1.stdout.trim()}`);
    console.log(`   Exit Code: ${result1.code}`);

    console.log('\n2️⃣  File System Operations (Built-in Commands):');
    const result2 = await $`mkdir -p temp-${runtime.toLowerCase()}`;
    console.log(`   Directory created: ${result2.code === 0 ? '✅' : '❌'}`);

    const result3 = await $`ls -la temp-${runtime.toLowerCase()}`;
    console.log(`   Directory listing: ${result3.code === 0 ? '✅' : '❌'}`);

    console.log('\n3️⃣  Pipeline Operations:');
    const result4 = await $`echo "1\n2\n3" | wc -l`;
    console.log(`   Line count: ${result4.stdout.trim()}`);

    console.log('\n4️⃣  Built-in Command Chains:');
    const result5 = await $`seq 1 3 | cat`;
    console.log(`   Sequence: ${result5.stdout.trim().replace(/\n/g, ', ')}`);

    console.log('\n5️⃣  Error Handling:');
    try {
      await $`sh -c 'exit 42'`;
    } catch (error) {
      console.log(`   Caught error with code: ${error.code} ✅`);
    }

    // Cleanup
    await $`rm -rf temp-${runtime.toLowerCase()}`;

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All basic await patterns work perfectly in ${runtime}!`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    process.exit(1);
  }
}

basicAwaitComparison();