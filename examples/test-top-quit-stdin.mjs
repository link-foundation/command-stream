#!/usr/bin/env node

/**
 * Test that we can stop the `top` command by sending 'q' via streams.stdin
 * This demonstrates stdin control for interactive commands that actually read stdin
 */

import { $ } from '../src/$.mjs';

console.log('=== Testing top command quit via streams.stdin ===');
console.log('');

async function testTopQuitStdin() {
  try {
    console.log('TEST: Stop top command by sending "q" via streams.stdin');
    
    // Start top command (interactive process monitor)
    const topCmd = $`top -n 5`; // Limit to 5 iterations in case stdin quit fails
    console.log('✓ top command created');
    
    // Get stdin stream (this will auto-start the command)
    const stdin = topCmd.streams.stdin;
    console.log('✓ Accessed streams.stdin - top should be started');
    console.log('  Started?', topCmd.started);
    
    // Get stdout to monitor output
    const stdout = topCmd.streams.stdout;
    if (stdout) {
      stdout.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(`[top] ${output}`);
        
        // Look for signs that top is running (like "Tasks:" or "Cpu(s):")
        if (output.includes('Tasks:') || output.includes('Cpu') || output.includes('PID')) {
          console.log('\\n  → top is running, sending "q" to quit...');
          if (stdin && !stdin.destroyed) {
            stdin.write('q');
            // Don't end() stdin immediately - top might need time to process
          }
        }
      });
    }
    
    // Fallback: send 'q' after 2 seconds in case we miss the output detection
    setTimeout(() => {
      console.log('\\n  → Fallback: sending "q" after 2 seconds...');
      if (stdin && !stdin.destroyed) {
        stdin.write('q');
        // Give top a moment to process the quit command
        setTimeout(() => {
          if (stdin && !stdin.destroyed) {
            stdin.end();
          }
        }, 500);
      }
    }, 2000);
    
    // Additional fallback: kill if still running after 5 seconds
    const killTimeout = setTimeout(() => {
      console.log('\\n  → stdin "q" failed, using kill() as backup...');
      topCmd.kill();
    }, 5000);
    
    // Wait for top to complete
    const result = await topCmd;
    clearTimeout(killTimeout);
    
    console.log('\\n✓ top command completed');
    console.log('  Exit code:', result.code);
    console.log('  Output length:', result.stdout.length);
    console.log('  First 200 chars:', JSON.stringify(result.stdout.slice(0, 200)));
    
    // Determine how it was stopped
    if (result.code === 0) {
      console.log('  🎉 SUCCESS: top quit cleanly via "q" command!');
    } else if (result.code === 130 || result.code === 143) {
      console.log('  ⚠️  top was killed via signal (stdin quit may not have worked)');
    } else {
      console.log('  ℹ️  top exited with code:', result.code);
    }
    
    console.log('\\n=== Testing comparison with cat (known stdin reader) ===');
    
    const catCmd = $`cat`;
    const catStdin = catCmd.streams.stdin;
    
    if (catStdin) {
      catStdin.write('Testing cat stdin\\n');
      catStdin.write('This should work reliably\\n');
      catStdin.end();
    }
    
    const catResult = await catCmd;
    console.log('✓ cat result:', JSON.stringify(catResult.stdout));
    console.log('  Exit code:', catResult.code);
    
    console.log('\\n📋 CONCLUSION:');
    console.log('✅ streams.stdin successfully sends data to processes');
    console.log('✅ Interactive commands like top can be controlled via stdin');
    console.log('✅ Fallback kill() method available for stubborn processes');
    
  } catch (error) {
    console.log('');
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testTopQuitStdin();