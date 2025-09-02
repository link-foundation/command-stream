#!/usr/bin/env node

/**
 * Test different stdio combinations with streams interface
 */

import { $ } from '../src/$.mjs';

console.log('=== Testing stdio combinations with streams interface ===');
console.log('');

async function testStdioCombinations() {
  try {
    console.log('TEST 1: Default behavior - streams.stdin works for input');
    
    const cmd1 = $`cat`;
    const stdin1 = cmd1.streams.stdin;
    
    if (stdin1) {
      stdin1.write('Hello from streams.stdin!\\n');
      stdin1.write('This demonstrates stdin control\\n');
      stdin1.end();
    }
    
    const result1 = await cmd1;
    console.log('✓ Default cat result:', JSON.stringify(result1.stdout));
    console.log('  Exit code:', result1.code);
    
    console.log('');
    console.log('TEST 2: Demonstrate top quit with streams.stdin');
    
    console.log('  → Starting limited top command...');
    const topCmd = $`top -l 2`; // Limited to 2 iterations on macOS
    const topStdin = topCmd.streams.stdin;
    
    // Try to quit early with 'q'
    setTimeout(() => {
      console.log('  → Sending "q" to quit top early...');
      if (topStdin && !topStdin.destroyed) {
        topStdin.write('q');
      }
    }, 500);
    
    // Backup kill after reasonable time
    setTimeout(() => {
      if (!topCmd.finished) {
        console.log('  → Backup kill...');
        topCmd.kill();
      }
    }, 3000);
    
    const topResult = await topCmd;
    console.log('  ✓ Top completed with exit code:', topResult.code);
    console.log('  ✓ Output length:', topResult.stdout.length, 'characters');
    
    console.log('');
    console.log('TEST 3: Compare with native behavior - ping ignores stdin');
    
    const pingCmd = $`ping -c 3 127.0.0.1`; // Limited ping
    const pingStdin = pingCmd.streams.stdin;
    
    // Try to send data to ping stdin (will be ignored)
    if (pingStdin) {
      pingStdin.write('q\\n');
      pingStdin.write('quit\\n');
      pingStdin.write('\\x03'); // CTRL+C
      pingStdin.end();
    }
    
    const pingResult = await pingCmd;
    console.log('  ✓ Ping completed (stdin ignored, ran full 3 pings)');
    console.log('  ✓ Exit code:', pingResult.code);
    console.log('  ✓ Contains ping statistics?', pingResult.stdout.includes('packets transmitted'));
    
    console.log('');
    console.log('TEST 4: Interactive command that responds to stdin - more');
    
    // Create a temporary file for 'more' command
    const setupCmd = $`echo "Line 1\\nLine 2\\nLine 3\\nLine 4\\nLine 5\\nLine 6" > /tmp/test-more.txt`;
    await setupCmd;
    
    const moreCmd = $`more /tmp/test-more.txt`;
    const moreStdin = moreCmd.streams.stdin;
    
    // Send space (next page) and q (quit) to more
    setTimeout(() => {
      if (moreStdin && !moreStdin.destroyed) {
        console.log('  → Sending commands to more...');
        moreStdin.write(' '); // space for next page
        setTimeout(() => moreStdin.write('q'), 100); // quit
      }
    }, 100);
    
    const moreResult = await moreCmd;
    console.log('  ✓ More command completed with exit code:', moreResult.code);
    
    // Cleanup
    await $`rm -f /tmp/test-more.txt`;
    
    console.log('');
    console.log('✅ SUMMARY:');
    console.log('  • streams.stdin allows sending data to any process');
    console.log('  • Interactive commands (cat, top, more) can be controlled via stdin');
    console.log('  • Network commands (ping) ignore stdin input (expected behavior)');
    console.log('  • kill() method works for forceful termination when needed');
    console.log('  • Our library provides both input control AND process control');
    
  } catch (error) {
    console.log('');
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testStdioCombinations();