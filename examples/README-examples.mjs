#!/usr/bin/env node

/**
 * Examples for README - using manual timing approach until async streams are perfected
 */

import { $ } from '../src/$.mjs';

console.log('📖 README Examples - Streaming Interfaces');
console.log('=' .repeat(50));

async function readmeExamples() {
  try {
    
    console.log('\\n✅ EXAMPLE 1: Basic stdin control with manual timing');
    console.log('─'.repeat(30));
    
    const catCmd = $`cat`;
    
    // Start the process explicitly
    catCmd.start({ mode: 'async', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    
    // Wait for process to spawn
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Now access stdin directly
    const stdin = catCmd.child ? catCmd.child.stdin : null;
    console.log('stdin available:', !!stdin);
    
    if (stdin) {
      stdin.write('Hello from stdin!\\n');
      stdin.write('Multiple lines work!\\n');
      stdin.end();
    }
    
    const result = await catCmd;
    console.log('Output:', JSON.stringify(result.stdout));
    
    console.log('\\n✅ EXAMPLE 2: Kill method for network commands');
    console.log('─'.repeat(30));
    
    const pingCmd = $`ping 8.8.8.8`;
    
    // Start monitoring output
    pingCmd.streams.stdout; // Auto-start
    
    // Kill after 1 second since ping ignores stdin
    setTimeout(() => {
      console.log('Killing ping...');
      pingCmd.kill();
    }, 1000);
    
    const pingResult = await pingCmd;
    console.log('Ping stopped with code:', pingResult.code);
    console.log('Captured output length:', pingResult.stdout.length);
    
    console.log('\\n✅ EXAMPLE 3: Using buffers and strings interfaces');
    console.log('─'.repeat(30));
    
    // Using buffers interface
    const bufferCmd = $`echo "Binary data"`;
    const buffer = await bufferCmd.buffers.stdout;
    console.log('Buffer result:', buffer.toString());
    
    // Using strings interface  
    const stringCmd = $`echo "Text data"`;
    const text = await stringCmd.strings.stdout;
    console.log('String result:', JSON.stringify(text.trim()));
    
    console.log('\\n✅ EXAMPLE 4: Mixed stdout/stderr');
    console.log('─'.repeat(30));
    
    const mixedCmd = $`sh -c 'echo "stdout" && echo "stderr" >&2'`;
    const [stdout, stderr] = await Promise.all([
      mixedCmd.strings.stdout,
      mixedCmd.strings.stderr
    ]);
    
    console.log('Stdout:', JSON.stringify(stdout.trim()));
    console.log('Stderr:', JSON.stringify(stderr.trim()));
    
    console.log('\\n✅ EXAMPLE 5: Backward compatibility');
    console.log('─'.repeat(30));
    
    // Traditional await syntax still works
    const compatCmd = await $`echo "backward compatible"`;
    console.log('Compatible result:', JSON.stringify(compatCmd.stdout.trim()));
    
    console.log('\\n' + '=' .repeat(50));
    console.log('🎉 All README examples completed!');
    console.log('\\n📋 Key Features:');
    console.log('  ✅ command.streams.stdin/stdout/stderr  - Node.js streams');
    console.log('  ✅ command.buffers.stdin/stdout/stderr - Buffer objects');
    console.log('  ✅ command.strings.stdin/stdout/stderr - String data');
    console.log('  ✅ command.kill()                       - Process termination');
    console.log('  ✅ Backward compatible with await       - Original syntax works');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

readmeExamples();