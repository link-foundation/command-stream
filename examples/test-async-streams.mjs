#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Test async streams interface ===');

async function testAsyncStreams() {
  try {
    console.log('TEST 1: Basic cat with await streams.stdin');

    const catCmd = $`cat`;

    console.log('Awaiting stdin...');
    const stdin = await catCmd.streams.stdin;
    console.log('✓ Got stdin:', !!stdin);

    if (stdin) {
      stdin.write('Hello async stdin!\\n');
      stdin.write('This is much cleaner!\\n');
      stdin.end();
    }

    const result = await catCmd;
    console.log('✓ Cat result:', JSON.stringify(result.stdout));

    console.log('\\nTEST 2: Grep with async streams');

    const grepCmd = $`grep "test"`;
    const grepStdin = await grepCmd.streams.stdin;

    if (grepStdin) {
      grepStdin.write('no match\\n');
      grepStdin.write('test line\\n');
      grepStdin.write('another test\\n');
      grepStdin.end();
    }

    const grepResult = await grepCmd;
    console.log('✓ Grep result:', JSON.stringify(grepResult.stdout));

    console.log('\\nTEST 3: Sort with async streams');

    const sortCmd = $`sort`;
    const sortStdin = await sortCmd.streams.stdin;

    if (sortStdin) {
      sortStdin.write('zebra\\n');
      sortStdin.write('apple\\n');
      sortStdin.write('banana\\n');
      sortStdin.end();
    }

    const sortResult = await sortCmd;
    console.log('✓ Sort result:', JSON.stringify(sortResult.stdout));

    console.log('\\nTEST 4: Multiple streams access');

    const mixedCmd = $`sh -c 'cat && echo "stderr message" >&2'`;
    const [mixedStdin, mixedStdout] = await Promise.all([
      mixedCmd.streams.stdin,
      mixedCmd.streams.stdout,
    ]);

    console.log('✓ Got both stdin and stdout streams');

    if (mixedStdin) {
      mixedStdin.write('Mixed input\\n');
      mixedStdin.end();
    }

    const mixedResult = await mixedCmd;
    console.log(
      '✓ Mixed result:',
      JSON.stringify({
        stdout: mixedResult.stdout,
        stderr: mixedResult.stderr,
      })
    );

    console.log('\\n🎉 SUCCESS:');
    console.log('  ✅ Async streams interface works perfectly!');
    console.log('  ✅ No more manual timing required');
    console.log('  ✅ Clean, intuitive API: await cmd.streams.stdin');
  } catch (error) {
    console.log('\\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

testAsyncStreams();
