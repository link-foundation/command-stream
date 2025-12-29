#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

async function testInteractiveStreaming() {
  console.log('Testing Interactive Streaming I/O\n');
  console.log('This test demonstrates real-time bidirectional streaming:');
  console.log('- Send math expressions to stdin');
  console.log('- Receive results from stdout');
  console.log('- Multiple iterations while process is running\n');

  // Start the interactive math calculator
  // Use relative path that works from any directory
  const calcPath = new URL('./interactive-math-calc.mjs', import.meta.url)
    .pathname;
  const calc = $`node ${calcPath}`;

  // Get the streams immediately (process auto-starts)
  const stdin = await calc.streams.stdin;
  const stdout = await calc.streams.stdout;
  const stderr = await calc.streams.stderr;

  console.log('Streams obtained:');
  console.log('  stdin:', stdin ? 'ready' : 'not available');
  console.log('  stdout:', stdout ? 'ready' : 'not available');
  console.log('  stderr:', stderr ? 'ready' : 'not available');
  console.log('');

  if (!stdin || !stdout) {
    console.error('Failed to get streams!');
    return;
  }

  // Set up stdout reader
  const results = [];
  let currentResult = '';

  stdout.on('data', (chunk) => {
    const text = chunk.toString();
    console.log('  <- Received:', text.trim());
    currentResult += text;

    // Check if we got a complete result
    if (
      text.includes('RESULT:') ||
      text.includes('READY') ||
      text.includes('GOODBYE')
    ) {
      results.push(text.trim());
      currentResult = '';
    }
  });

  // Set up stderr reader
  stderr.on('data', (chunk) => {
    console.error('  <- Error:', chunk.toString().trim());
  });

  // Wait for calculator to be ready
  await new Promise((resolve) => {
    const checkReady = () => {
      if (results.some((r) => r.includes('READY'))) {
        resolve();
      } else {
        setTimeout(checkReady, 10);
      }
    };
    checkReady();
  });

  console.log('\n--- Starting Interactive Math Session ---\n');

  // Test cases
  const expressions = [
    '1+2',
    '10*5',
    '100/4',
    '7-3',
    '2**8', // Power of 2
  ];

  for (const expr of expressions) {
    console.log(`  -> Sending: ${expr}`);
    stdin.write(`${expr}\n`);

    // Wait for result
    const startResults = results.length;
    await new Promise((resolve) => {
      const checkResult = () => {
        if (results.length > startResults) {
          resolve();
        } else {
          setTimeout(checkResult, 10);
        }
      };
      setTimeout(checkResult, 10);
    });

    // Small delay between calculations
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n--- Ending Session ---\n');

  // Send exit command
  console.log('  -> Sending: exit');
  stdin.write('exit\n');

  // Wait for goodbye message
  await new Promise((resolve) => {
    const checkGoodbye = () => {
      if (results.some((r) => r.includes('GOODBYE'))) {
        resolve();
      } else {
        setTimeout(checkGoodbye, 10);
      }
    };
    setTimeout(checkGoodbye, 10);
  });

  // Wait for process to complete
  const result = await calc;

  console.log('\n--- Summary ---');
  console.log('Process exited with code:', result.code);
  console.log(
    'Total results received:',
    results.filter((r) => r.includes('RESULT:')).length
  );
  console.log('\nAll results:');
  results.forEach((r) => {
    if (r.includes('RESULT:')) {
      console.log(`  ${r}`);
    }
  });

  console.log('\n✅ Interactive streaming test completed successfully!');
}

testInteractiveStreaming().catch(console.error);
