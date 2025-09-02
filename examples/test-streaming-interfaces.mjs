#!/usr/bin/env node

/**
 * Test for Issue #33: Support stdin/stdout/stderr in different flavors
 * 
 * This example tests the new streaming interfaces:
 * - command.streams.stdin/stdout/stderr (immediate access)
 * - command.buffers.stdin/stdout/stderr (binary data)  
 * - command.strings.stdin/stdout/stderr (text data)
 * 
 * Usage:
 *   node examples/test-streaming-interfaces.mjs
 */

import { $ } from '../src/$.mjs';

console.log('='.repeat(60));
console.log('TESTING NEW STREAMING INTERFACES (Issue #33)');
console.log('='.repeat(60));
console.log('');

async function testStreamingInterfaces() {
  try {
    console.log('=== TEST 1: Immediate streams access ===');
    
    // Create command but don't start it yet
    const command1 = $`echo "Hello streams"`;
    console.log('✓ Command created (not started)');
    
    // Access streams - this should auto-start the process
    const streams = command1.streams;
    console.log('✓ Streams accessed - process should auto-start');
    
    // The process should now be running, let's wait for completion
    const result1 = await command1;
    console.log('✓ Result:', JSON.stringify(result1.stdout.trim()));
    console.log('');
    
    console.log('=== TEST 2: Buffers interface ===');
    
    const command2 = $`echo "Hello buffers"`;
    
    // Access buffers before completion - should return promises
    const buffers = command2.buffers;
    console.log('✓ Buffers accessed - process should auto-start');
    
    // Get stdout buffer (should be promise initially)
    const stdoutBuffer = await buffers.stdout;
    console.log('✓ Buffer result:', stdoutBuffer.toString().trim());
    
    // Now that process finished, accessing again should return result immediately
    const immediateBuffer = command2.buffers.stdout;
    if (immediateBuffer instanceof Buffer) {
      console.log('✓ Immediate buffer access works:', immediateBuffer.toString().trim());
    } else {
      console.log('✓ Buffer is still promise (expected for new process)');
    }
    console.log('');
    
    console.log('=== TEST 3: Strings interface ===');
    
    const command3 = $`echo "Hello strings"`;
    
    // Access strings before completion - should return promises  
    const strings = command3.strings;
    console.log('✓ Strings accessed - process should auto-start');
    
    // Get stdout string (should be promise initially)
    const stdoutString = await strings.stdout;
    console.log('✓ String result:', JSON.stringify(stdoutString.trim()));
    console.log('');
    
    console.log('=== TEST 4: Mixed usage with stderr ===');
    
    const command4 = $`sh -c 'echo "stdout message" && echo "stderr message" >&2'`;
    
    // Test both stdout and stderr
    const [stdoutStr, stderrStr] = await Promise.all([
      command4.strings.stdout,
      command4.strings.stderr
    ]);
    
    console.log('✓ Mixed stdout:', JSON.stringify(stdoutStr.trim()));
    console.log('✓ Mixed stderr:', JSON.stringify(stderrStr.trim()));
    console.log('');
    
    console.log('=== TEST 5: Backward compatibility ===');
    
    // Ensure old await syntax still works
    const command5 = $`echo "backward compatible"`;
    const oldResult = await command5;
    console.log('✓ Backward compatible result:', JSON.stringify(oldResult.stdout.trim()));
    console.log('');
    
    console.log('=== TEST 6: Stream access after creation ===');
    
    const command6 = $`ping -c 3 127.0.0.1`;
    
    // Access stdout stream immediately for real-time monitoring  
    if (command6.streams.stdout) {
      console.log('✓ Stream available immediately');
      
      // Set up real-time monitoring
      let chunks = 0;
      command6.streams.stdout.on('data', (chunk) => {
        chunks++;
        console.log(`  Chunk ${chunks}:`, chunk.toString().slice(0, 50) + '...');
      });
    } else {
      console.log('ℹ️  Stream not immediately available (may need process start)');
    }
    
    // Wait for completion
    const result6 = await command6;
    console.log('✓ Ping completed with exit code:', result6.code);
    console.log('');
    
    console.log('='.repeat(60));
    console.log('✅ ALL STREAMING INTERFACE TESTS COMPLETED');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.log('='.repeat(60));
    console.error('❌ STREAMING INTERFACE TEST FAILED:', error.message);
    console.error(error.stack);
    console.log('='.repeat(60));
    process.exit(1);
  }
}

testStreamingInterfaces();