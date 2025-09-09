#!/usr/bin/env node
/**
 * EventEmitter Pattern: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates event-driven command execution
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function eventEmitterComparison() {
  try {
    console.log('1️⃣  Basic Event Handling:');
    
    const cmd1 = $`echo "Testing events in ${runtime}"`
      .on('data', (chunk) => {
        console.log(`   📥 Data: ${chunk.data.toString().trim()}`);
      })
      .on('end', (result) => {
        console.log(`   🏁 End: Exit code ${result.code}`);
      });
    
    await cmd1;

    console.log('\n2️⃣  Multiple Event Listeners:');
    
    let dataEvents = 0;
    let stderrEvents = 0;
    
    const cmd2 = $`sh -c 'echo "stdout"; echo "stderr" >&2; echo "more stdout"'`
      .on('data', (chunk) => {
        dataEvents++;
        console.log(`   📨 ${chunk.type}: ${chunk.data.toString().trim()}`);
      })
      .on('stderr', (chunk) => {
        stderrEvents++;
        console.log(`   🚨 Stderr: ${chunk.toString().trim()}`);
      })
      .on('exit', (code) => {
        console.log(`   🚪 Exit: Code ${code}`);
      });
    
    await cmd2;
    console.log(`   Events captured: ${dataEvents} data, ${stderrEvents} stderr`);

    console.log('\n3️⃣  Pipeline Event Handling:');
    
    let pipelineEvents = 0;
    
    const cmd3 = $`seq 1 3 | cat`
      .on('data', (chunk) => {
        if (chunk.type === 'stdout') {
          pipelineEvents++;
          console.log(`   🔗 Pipeline: ${chunk.data.toString().trim()}`);
        }
      });
    
    await cmd3;
    console.log(`   Pipeline events: ${pipelineEvents}`);

    console.log('\n4️⃣  Error Event Handling:');
    
    try {
      const cmd4 = $`sh -c 'echo "before error"; exit 1; echo "after error"'`
        .on('data', (chunk) => {
          console.log(`   📝 Before error: ${chunk.data.toString().trim()}`);
        })
        .on('error', (error) => {
          console.log(`   ⚠️  Error event: ${error.message}`);
        });
      
      await cmd4;
    } catch (error) {
      console.log(`   ✅ Caught error: Code ${error.code}`);
    }

    console.log('\n5️⃣  Mixed Pattern (Events + Await):');
    
    const mixedCmd = $`echo "Mixed pattern works in ${runtime}"`
      .on('data', (chunk) => {
        console.log(`   🔄 Real-time: ${chunk.data.toString().trim()}`);
      });
    
    const result = await mixedCmd;
    console.log(`   📊 Final result: ${result.stdout.trim()}`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All EventEmitter patterns work perfectly in ${runtime}!`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    process.exit(1);
  }
}

eventEmitterComparison();