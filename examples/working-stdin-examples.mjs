#!/usr/bin/env node

/**
 * Working examples of stdin control that account for async process spawning
 */

import { $ } from '../src/$.mjs';

console.log('=== Working stdin control examples ===');

async function workingStdinExamples() {
  try {
    console.log('EXAMPLE 1: Basic cat with stdin (immediate approach)');
    
    const catCmd = $`cat`;
    
    // Access stdin to start the process
    const stdinPromise = new Promise((resolve) => {
      const checkStdin = () => {
        const stdin = catCmd.streams.stdin;
        if (stdin) {
          resolve(stdin);
        } else {
          setTimeout(checkStdin, 10); // Check again in 10ms
        }
      };
      checkStdin();
    });
    
    const stdin = await stdinPromise;
    console.log('✓ Got stdin stream');
    
    stdin.write('Hello from stdin!\\n');
    stdin.write('This actually works!\\n');
    stdin.end();
    
    const result = await catCmd;
    console.log('✓ Cat result:', JSON.stringify(result.stdout));
    
    console.log('\\nEXAMPLE 2: Grep filtering with stdin');
    
    const grepCmd = $`grep "hello"`;
    
    // Start and wait for stdin to be available
    grepCmd.streams.stdout; // Trigger start
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for spawn
    
    const grepStdin = grepCmd.streams.stdin;
    if (grepStdin) {
      grepStdin.write('no match here\\n');
      grepStdin.write('hello world\\n');
      grepStdin.write('another line\\n');
      grepStdin.write('hello again\\n');
      grepStdin.end();
    }
    
    const grepResult = await grepCmd;
    console.log('✓ Grep result:', JSON.stringify(grepResult.stdout));
    
    console.log('\\nEXAMPLE 3: Sort with stdin');
    
    const sortCmd = $`sort`;
    sortCmd.streams.stdout; // Start the process
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const sortStdin = sortCmd.streams.stdin;
    if (sortStdin) {
      sortStdin.write('zebra\\n');
      sortStdin.write('apple\\n');
      sortStdin.write('banana\\n');
      sortStdin.end();
    }
    
    const sortResult = await sortCmd;
    console.log('✓ Sort result:', JSON.stringify(sortResult.stdout));
    
    console.log('\\nEXAMPLE 4: bc calculator with stdin commands');
    
    const bcCmd = $`bc -l`;
    bcCmd.streams.stdout; // Start
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const bcStdin = bcCmd.streams.stdin;
    if (bcStdin) {
      bcStdin.write('2 + 3\\n');
      bcStdin.write('10 * 5\\n');
      bcStdin.write('quit\\n');
    }
    
    const bcResult = await bcCmd;
    console.log('✓ bc result:', JSON.stringify(bcResult.stdout));
    
    console.log('\\nEXAMPLE 5: Using kill() for processes that ignore stdin');
    
    const pingCmd = $`ping 8.8.8.8`;
    pingCmd.streams.stdout; // Start
    
    // Try stdin (will be ignored by ping)
    setTimeout(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      const pingStdin = pingCmd.streams.stdin;
      if (pingStdin) {
        pingStdin.write('q\\n');
        pingStdin.write('\\x03'); // CTRL+C
        pingStdin.end();
      }
    }, 100);
    
    // Use kill() since ping ignores stdin
    setTimeout(() => {
      console.log('  → ping ignores stdin, using kill()...');
      pingCmd.kill();
    }, 1000);
    
    const pingResult = await pingCmd;
    console.log('✓ ping terminated with code:', pingResult.code);
    console.log('✓ ping output length:', pingResult.stdout.length);
    
    console.log('\\n🎉 CONCLUSIONS:');
    console.log('  ✅ stdin works great with text processing commands (cat, grep, sort, bc)');
    console.log('  ✅ Need to wait ~50-100ms after starting for stdin to be available');  
    console.log('  ✅ Network commands (ping) ignore stdin → use kill() method');
    console.log('  ✅ Our streaming interfaces provide both input control AND process control');
    
  } catch (error) {
    console.log('\\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

workingStdinExamples();