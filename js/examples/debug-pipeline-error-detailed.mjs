#!/usr/bin/env bun
// Detailed debug script for pipeline error cleanup

import { $ } from '../js/src/$.mjs';

// Enable verbose mode for tracing
process.env.COMMAND_STREAM_VERBOSE = 'true';

function getInternalState() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter((l) => {
    const str = l.toString();
    return (
      str.includes('activeProcessRunners') ||
      str.includes('ProcessRunner') ||
      str.includes('activeChildren')
    );
  });

  return {
    sigintHandlerCount: commandStreamListeners.length,
    totalSigintListeners: sigintListeners.length,
  };
}

async function testPipelineErrorDetailed() {
  console.log('=== Pipeline Error Detailed Debug ===');

  console.log('\n1. Initial state:', getInternalState());

  console.log('\n2. Creating pipeline runner...');
  const runner = $`echo "test" | exit 1 | cat`;
  console.log('After creating runner:', getInternalState());

  console.log('\n3. Starting pipeline...');
  let result, error;
  try {
    result = await runner;
    console.log('Pipeline succeeded (unexpected):', result);
  } catch (e) {
    error = e;
    console.log('Pipeline failed (expected):', e.message, 'code:', e.code);
  }

  console.log('\n4. Immediately after pipeline completion/failure:');
  console.log('State:', getInternalState());
  console.log('Runner finished?', runner.finished);
  console.log('Runner started?', runner.started);

  console.log('\n5. After 10ms:');
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log('State:', getInternalState());

  console.log('\n6. After 50ms:');
  await new Promise((resolve) => setTimeout(resolve, 40));
  console.log('State:', getInternalState());

  console.log('\n7. After 100ms:');
  await new Promise((resolve) => setTimeout(resolve, 50));
  console.log('State:', getInternalState());

  // Manually cleanup if needed
  console.log('\n8. Manual cleanup test...');
  if (typeof runner._cleanup === 'function') {
    runner._cleanup();
    console.log('After manual cleanup:', getInternalState());
  }

  // Check if runner can be killed
  console.log('\n9. Kill test...');
  if (!runner.finished) {
    runner.kill();
    console.log('After kill:', getInternalState());
    console.log('Runner finished after kill?', runner.finished);
  }
}

testPipelineErrorDetailed().catch(console.error);
