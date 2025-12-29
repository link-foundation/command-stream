#!/usr/bin/env bun
// Debug the virtual exit command directly

import { $ } from '../js/src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

// Test just the problematic pipeline
async function testProblematicPipeline() {
  console.log('=== Problematic Pipeline Debug ===');

  function getState() {
    return {
      sigintHandlers: process.listeners('SIGINT').length,
      timestamp: new Date().toISOString(),
    };
  }

  console.log('\n1. Initial state:', getState());

  console.log('\n2. Creating runner...');
  const runner = $`echo "test" | exit 1 | cat`;
  console.log('After creation:', getState());
  console.log('Runner details:', {
    finished: runner.finished,
    started: runner.started,
    spec: runner.spec,
  });

  console.log('\n3. Executing pipeline...');
  try {
    const result = await runner;
    console.log('Pipeline succeeded (unexpected):', result);
    console.log('After success:', getState());
  } catch (e) {
    console.log('Pipeline failed (expected):', e.message);
    console.log('Error details:', {
      code: e.code,
      hasResult: !!e.result,
      keys: Object.keys(e),
    });
    console.log('After failure:', getState());
  }

  console.log('\n4. Runner final state:', {
    finished: runner.finished,
    started: runner.started,
  });

  console.log('\n5. Final state:', getState());
}

testProblematicPipeline().catch(console.error);
