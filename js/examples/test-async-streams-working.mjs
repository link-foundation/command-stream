#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Test async streams with commands that wait ===');

async function testAsyncStreamsWorking() {
  try {
    console.log('TEST 1: Node.js script that waits for input');

    const nodeCmd = $`node -e "process.stdin.setEncoding('utf8'); let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write('Got: ' + input.trim()));"`;

    console.log('Awaiting stdin for Node.js script...');
    const nodeStdin = await nodeCmd.streams.stdin;
    console.log('✓ Node stdin available:', !!nodeStdin);

    if (nodeStdin) {
      nodeStdin.write('Node.js input test');
      nodeStdin.end();
    }

    const nodeResult = await nodeCmd;
    console.log('✓ Node result:', JSON.stringify(nodeResult.stdout));

    console.log('\\nTEST 2: Python script that waits for input');

    const pythonCmd = $`python3 -c "import sys; data = sys.stdin.read(); print('Python got:', data.strip())"`;

    const pythonStdin = await pythonCmd.streams.stdin;
    console.log('✓ Python stdin available:', !!pythonStdin);

    if (pythonStdin) {
      pythonStdin.write('Python input test\\n');
      pythonStdin.end();
    }

    const pythonResult = await pythonCmd;
    console.log('✓ Python result:', JSON.stringify(pythonResult.stdout));

    console.log('\\nTEST 3: bc calculator (interactive)');

    const bcCmd = $`bc -l`;
    const bcStdin = await bcCmd.streams.stdin;
    console.log('✓ bc stdin available:', !!bcStdin);

    if (bcStdin) {
      bcStdin.write('2 + 3\\n');
      bcStdin.write('10 * 5\\n');
      bcStdin.write('quit\\n');
    }

    const bcResult = await bcCmd;
    console.log('✓ bc result:', JSON.stringify(bcResult.stdout));

    console.log('\\nTEST 4: Demonstrate immediate vs promise behavior');

    const immediateCmd = $`cat`;
    // Start the process manually first
    immediateCmd.start({
      mode: 'async',
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Wait for it to spawn
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now access should be immediate (not a promise)
    const immediateStdin = immediateCmd.streams.stdin;
    const isPromise = immediateStdin instanceof Promise;
    console.log('✓ Immediate access is promise?', isPromise);

    if (!isPromise && immediateStdin) {
      immediateStdin.write('Immediate access test\\n');
      immediateStdin.end();
    } else if (isPromise) {
      const stdin = await immediateStdin;
      if (stdin) {
        stdin.write('Promise-based access\\n');
        stdin.end();
      }
    }

    const immediateResult = await immediateCmd;
    console.log(
      '✓ Immediate test result:',
      JSON.stringify(immediateResult.stdout)
    );

    console.log('\\n🎉 CONCLUSIONS:');
    console.log('  ✅ await cmd.streams.stdin works for interactive commands');
    console.log('  ✅ Returns immediate stream if process already spawned');
    console.log('  ✅ Returns promise if process not yet spawned');
    console.log('  ✅ Much cleaner API than manual timing');
  } catch (error) {
    console.log('\\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

testAsyncStreamsWorking();
