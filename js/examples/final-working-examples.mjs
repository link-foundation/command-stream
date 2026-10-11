#!/usr/bin/env node

/**
 * Final working examples of streaming interfaces for README
 */

import { $ } from '../src/$.mjs';

console.log('🚀 Final Working Examples - Streaming Interfaces');
console.log('='.repeat(55));

async function finalWorkingExamples() {
  try {
    console.log('\\n📝 EXAMPLE 1: Send data via streams.stdin');
    console.log('─'.repeat(30));

    // Create a simple echo script that waits for input
    const echoCmd = $`node -e "process.stdin.pipe(process.stdout)"`;
    const stdin = await echoCmd.streams.stdin;

    if (stdin) {
      stdin.write('Hello from stdin!\\n');
      stdin.write('Multiple lines work!\\n');
      stdin.end();
    }

    const result = await echoCmd;
    console.log('✅ Output:', JSON.stringify(result.stdout));

    console.log('\\n🔧 EXAMPLE 2: Filter data with grep');
    console.log('─'.repeat(30));

    const grepCmd = $`grep "important"`;
    const grepStdin = await grepCmd.streams.stdin;

    if (grepStdin) {
      grepStdin.write('ignore this line\\n');
      grepStdin.write('important message 1\\n');
      grepStdin.write('skip this too\\n');
      grepStdin.write('another important note\\n');
      grepStdin.end();
    }

    const grepResult = await grepCmd;
    console.log('✅ Filtered output:', JSON.stringify(grepResult.stdout));

    console.log('\\n📊 EXAMPLE 3: Sort data via stdin');
    console.log('─'.repeat(30));

    const sortCmd = $`sort`;
    const sortStdin = await sortCmd.streams.stdin;

    if (sortStdin) {
      sortStdin.write('zebra\\n');
      sortStdin.write('apple\\n');
      sortStdin.write('banana\\n');
      sortStdin.write('cherry\\n');
      sortStdin.end();
    }

    const sortResult = await sortCmd;
    console.log('✅ Sorted output:', JSON.stringify(sortResult.stdout));

    console.log('\\n🧮 EXAMPLE 4: Calculator with bc');
    console.log('─'.repeat(30));

    const calcCmd = $`bc -l`;
    const calcStdin = await calcCmd.streams.stdin;

    if (calcStdin) {
      calcStdin.write('scale=2\\n'); // Set decimal precision
      calcStdin.write('10 / 3\\n'); // Division
      calcStdin.write('sqrt(16)\\n'); // Square root
      calcStdin.write('quit\\n'); // Exit
    }

    const calcResult = await calcCmd;
    console.log(
      '✅ Calculation results:',
      JSON.stringify(calcResult.stdout.trim())
    );

    console.log('\\n🔄 EXAMPLE 5: Text transformation with tr');
    console.log('─'.repeat(30));

    const trCmd = $`tr 'a-z' 'A-Z'`; // Convert to uppercase
    const trStdin = await trCmd.streams.stdin;

    if (trStdin) {
      trStdin.write('hello world\\n');
      trStdin.write('this is lowercase text\\n');
      trStdin.end();
    }

    const trResult = await trCmd;
    console.log('✅ Transformed text:', JSON.stringify(trResult.stdout));

    console.log(
      '\\n⚡ EXAMPLE 6: Process control - kill() for commands that ignore stdin'
    );
    console.log('─'.repeat(30));

    const pingCmd = $`ping -c 10 8.8.8.8`; // Long ping

    // Try stdin (will be ignored by ping)
    setTimeout(async () => {
      const pingStdin = await pingCmd.streams.stdin;
      if (pingStdin) {
        pingStdin.write('q\\n');
        pingStdin.end();
        console.log('  📝 Sent "q" to ping (will be ignored)');
      }
    }, 500);

    // Use kill() since ping ignores stdin
    setTimeout(() => {
      console.log('  🔪 Using kill() method to stop ping...');
      pingCmd.kill();
    }, 1500);

    const pingResult = await pingCmd;
    console.log('✅ Ping stopped with exit code:', pingResult.code);
    console.log(
      '✅ Captured',
      pingResult.stdout.length,
      'characters of output'
    );

    console.log('\\n🎯 EXAMPLE 7: Mixed stdout/stderr handling');
    console.log('─'.repeat(30));

    const mixedCmd = $`sh -c 'echo "stdout message" && echo "stderr message" >&2'`;

    const [stdout, stderr] = await Promise.all([
      mixedCmd.strings.stdout,
      mixedCmd.strings.stderr,
    ]);

    console.log('✅ Stdout:', JSON.stringify(stdout.trim()));
    console.log('✅ Stderr:', JSON.stringify(stderr.trim()));

    console.log(`\\n${'='.repeat(55)}`);
    console.log('🎉 ALL STREAMING EXAMPLES COMPLETED SUCCESSFULLY!');
    console.log('\\n📋 Key Takeaways:');
    console.log(
      '  ✅ await cmd.streams.stdin  - Send data to interactive commands'
    );
    console.log('  ✅ await cmd.buffers.stdout - Get binary data');
    console.log('  ✅ await cmd.strings.stderr - Get text data');
    console.log(
      '  ✅ cmd.kill()               - Stop processes that ignore stdin'
    );
    console.log('  ✅ Works with: grep, sort, bc, tr, node, python, etc.');
    console.log('  ✅ Network commands (ping) need kill(), not stdin');
  } catch (error) {
    console.log('\\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

finalWorkingExamples();
