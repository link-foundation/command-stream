#!/usr/bin/env bun
// Debug script to test pipeline cleanup issues

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testPipelineCleanup() {
  console.log('=== Pipeline Cleanup Debug ===');

  console.log('\n1. Testing basic pipeline...');
  try {
    const result1 = await $`echo "test"`.pipe($`cat`);
    console.log('Basic pipeline result:', result1.stdout);
  } catch (error) {
    console.log('Basic pipeline error:', error.message);
  }

  console.log('\n2. Testing pipeline with virtual commands...');
  try {
    const result2 = await $`ls`.pipe($`cat`);
    console.log('Virtual pipeline result length:', result2.stdout.length);
  } catch (error) {
    console.log('Virtual pipeline error:', error.message);
  }

  console.log('\n3. Testing multi-stage pipeline...');
  try {
    const result3 = await $`echo "line1\\nline2\\nline3"`
      .pipe($`grep "line"`)
      .pipe($`wc -l`);
    console.log('Multi-stage pipeline result:', result3.stdout.trim());
  } catch (error) {
    console.log('Multi-stage pipeline error:', error.message);
  }

  console.log('\n4. Testing pipeline with error...');
  try {
    const result4 = await $`echo "test"`.pipe($`nonexistent-command`);
    console.log('Error pipeline result:', result4.stdout);
  } catch (error) {
    console.log('Expected error pipeline error:', error.message);
  }

  console.log('\n5. Testing pipeline interruption...');
  const longPipeline = $`yes`.pipe($`head -1000`);
  const pipelinePromise = longPipeline.start();

  // Interrupt after a short delay
  setTimeout(() => {
    console.log('Interrupting pipeline...');
    longPipeline.kill('SIGINT');
  }, 50);

  try {
    const result5 = await pipelinePromise;
    console.log('Interrupted pipeline result length:', result5.stdout.length);
  } catch (error) {
    console.log(
      'Interrupted pipeline error:',
      error.message,
      'code:',
      error.code
    );
  }

  console.log('\nPipeline tests completed');
}

testPipelineCleanup().catch(console.error);
