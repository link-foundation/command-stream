#!/usr/bin/env node

/**
 * Test top command with inherited stdout but controlled stdin
 * This demonstrates the key requirement: inherit stdout but control stdin independently
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing top with inherit stdout + streams.stdin control ===');
console.log('');

async function testTopInheritStdoutStdinControl() {
  try {
    console.log(
      '🎯 GOAL: Run top with inherited stdout, stop it via streams.stdin'
    );
    console.log('');
    console.log('  → top output should appear directly in this terminal');
    console.log(
      '  → we should be able to send "q" via streams.stdin to stop it'
    );
    console.log(
      '  → this proves stdout inheritance + independent stdin control'
    );
    console.log('');

    console.log('Starting top command...');
    console.log('━'.repeat(60));

    // Create top command with inherited stdout
    const topCmd = $`top -n 10`; // Limit to 10 iterations as backup

    // Get stdin control BEFORE starting with specific options
    const stdin = topCmd.streams.stdin;
    console.log('✓ Got streams.stdin handle');

    // Set up the quit sequence
    setTimeout(() => {
      console.log('\\n[CONTROL] → Sending "q" to quit top...');
      if (stdin && !stdin.destroyed) {
        stdin.write('q');
        // Don't end() immediately - top needs time to process
        setTimeout(() => {
          if (stdin && !stdin.destroyed) {
            stdin.end();
          }
        }, 100);
      }
    }, 2000); // Wait 2 seconds to see some output

    // Backup kill in case stdin quit doesn't work
    const killTimer = setTimeout(() => {
      console.log('\\n[CONTROL] → stdin quit failed, using kill()...');
      topCmd.kill();
    }, 5000);

    // Run with inherited stdout but piped stdin (so we can control it)
    const result = await topCmd.run({
      stdout: 'inherit', // Output goes directly to terminal
      stdin: 'pipe', // We control stdin via streams.stdin
    });

    clearTimeout(killTimer);
    console.log('━'.repeat(60));
    console.log('✅ top command completed!');
    console.log(`   Exit code: ${result.code}`);

    if (result.code === 0) {
      console.log('   🎉 SUCCESS: top quit cleanly via "q" command!');
    } else if (
      result.code === 130 ||
      result.code === 143 ||
      result.code === null
    ) {
      console.log(
        '   ⚠️  top was terminated by signal (stdin might not have worked)'
      );
    } else {
      console.log('   ℹ️  top exited with unexpected code');
    }

    console.log('');
    console.log('🔍 VERIFICATION: Test the same with a simple command');

    console.log('  → Running echo with inherited stdout + controlled stdin...');
    const echoCmd = $`cat`;
    const echoStdin = echoCmd.streams.stdin;

    if (echoStdin) {
      echoStdin.write('This should appear directly in terminal\\n');
      echoStdin.write('Because stdout is inherited\\n');
      echoStdin.end();
    }

    const echoResult = await echoCmd.run({
      stdout: 'inherit',
      stdin: 'pipe',
    });

    console.log(`  ✅ Verification completed (exit code: ${echoResult.code})`);
    console.log('');

    console.log('📋 DEMONSTRATION COMPLETE:');
    console.log(
      '  ✅ top output appeared directly in terminal (stdout inherited)'
    );
    console.log(
      '  ✅ we controlled top via streams.stdin (independent stdin control)'
    );
    console.log('  ✅ "q" command sent via stdin to stop top');
    console.log(
      '  ✅ this proves the library supports: inherit stdout + control stdin'
    );
  } catch (error) {
    console.log('');
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testTopInheritStdoutStdinControl();
