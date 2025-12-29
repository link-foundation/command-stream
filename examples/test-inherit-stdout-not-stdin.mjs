#!/usr/bin/env node

/**
 * Test that we can inherit stdout but not stdin
 * This allows parent process to see output, but child doesn't read from parent's stdin
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing inherit stdout but not stdin ===');
console.log('');

async function testInheritStdoutNotStdin() {
  try {
    console.log('TEST 1: Inherit stdout - output should appear directly');

    // This should inherit stdout so we see the output directly
    const inheritStdoutCmd = $`echo "This output should appear directly"`;

    // Set stdout to inherit mode
    const result1 = await inheritStdoutCmd.run({
      stdout: 'inherit',
      stdin: 'pipe',
    });
    console.log('✓ Command completed with inherit stdout');
    console.log('  Exit code:', result1.code);
    console.log(
      '  Captured stdout (should be empty due to inherit):',
      JSON.stringify(result1.stdout)
    );

    console.log('');
    console.log('TEST 2: Control stdin independently while inheriting stdout');

    // Create a command that can read from both stdin and produce stdout
    const catCmd = $`cat`;

    // Access streams to control individually
    const stdin = catCmd.streams.stdin;

    console.log('  → Sending data to stdin while stdout is inherited...');
    if (stdin) {
      stdin.write('Hello from controlled stdin!\\n');
      stdin.write('This comes from our code, not the parent process stdin\\n');
      stdin.end();
    }

    const catResult = await catCmd.run({ stdout: 'inherit' });
    console.log('✓ Cat completed with controlled stdin and inherited stdout');
    console.log('  Exit code:', catResult.code);

    console.log('');
    console.log('TEST 3: Verify different stdio combinations work');

    console.log('  3a: Capture stdout, pipe stdin');
    const cmd3a = $`cat`;
    const stdin3a = cmd3a.streams.stdin;
    if (stdin3a) {
      stdin3a.write('Captured output test\\n');
      stdin3a.end();
    }
    const result3a = await cmd3a.run({ stdout: 'pipe', stdin: 'pipe' });
    console.log('    Result:', JSON.stringify(result3a.stdout));

    console.log(
      "  3b: Inherit stdout, ignore stdin (for commands that don't need stdin)"
    );
    const result3b = await $`echo "Direct output"`.run({
      stdout: 'inherit',
      stdin: 'ignore',
    });
    console.log('    Exit code:', result3b.code);

    console.log('  3c: Mixed mode - inherit stdout, controlled stdin');
    const cmd3c = $`grep "hello"`;
    const stdin3c = cmd3c.streams.stdin;
    if (stdin3c) {
      stdin3c.write('hello world\\n');
      stdin3c.write('test line\\n');
      stdin3c.write('hello again\\n');
      stdin3c.end();
    }
    await cmd3c.run({ stdout: 'inherit', stdin: 'pipe' });
    console.log('    ✓ grep completed with inherited stdout');

    console.log('');
    console.log(
      'TEST 4: Verify top command with inherited stdout and controlled stdin'
    );

    console.log(
      '  → Starting top with inherited stdout, sending "q" via stdin...'
    );
    const topCmd = $`top -n 3`; // Limit iterations
    const topStdin = topCmd.streams.stdin;

    // Send quit command after a brief delay
    setTimeout(() => {
      if (topStdin) {
        console.log('  → Sending "q" to quit top...');
        topStdin.write('q');
        topStdin.end();
      }
    }, 1000);

    // Fallback kill
    setTimeout(() => {
      console.log('  → Fallback kill...');
      topCmd.kill();
    }, 3000);

    const topResult = await topCmd.run({ stdout: 'inherit', stdin: 'pipe' });
    console.log('  ✓ Top completed, exit code:', topResult.code);

    console.log('');
    console.log('✅ CONCLUSIONS:');
    console.log('  • stdout can be inherited (appears directly in terminal)');
    console.log('  • stdin can be controlled independently via streams.stdin');
    console.log(
      '  • This combination allows seeing output while controlling input'
    );
    console.log(
      '  • Perfect for interactive commands that need specific input'
    );
  } catch (error) {
    console.log('');
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testInheritStdoutNotStdin();
