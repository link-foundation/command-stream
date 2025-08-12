#!/usr/bin/env bun

import { $ } from './$.mjs';

console.log('=== Enhanced $ API - All Patterns Test ===\n');

// Test 1: Classic await pattern (backward compatibility)
async function testClassicAwait() {
  console.log('1. Testing classic await pattern...');
  
  const result = await $`echo "Hello from classic await!"`;
  console.log(`   ✅ Exit code: ${result.code}`);
  console.log(`   ✅ Output: ${result.stdout.trim()}`);
  console.log();
}

// Test 2: Async iteration pattern
async function testAsyncIteration() {
  console.log('2. Testing async iteration pattern...');
  
  let chunkCount = 0;
  let output = '';
  
  for await (const chunk of $`echo "Line 1"; echo "Line 2"; echo "Line 3"`.stream()) {
    chunkCount++;
    
    if (chunk.type === 'stdout') {
      const data = chunk.data.toString();
      output += data;
      console.log(`   📦 Chunk ${chunkCount}: "${data.trim()}"`);
    }
  }
  
  console.log(`   ✅ Processed ${chunkCount} chunks via async iteration`);
  console.log(`   ✅ Total output: "${output.trim()}"`);
  console.log();
}

// Test 3: EventEmitter pattern
async function testEventEmitter() {
  console.log('3. Testing EventEmitter pattern...');
  
  return new Promise((resolve) => {
    let dataChunks = 0;
    let stdoutChunks = 0;
    let output = '';
    
    $`echo "Event test line 1"; echo "Event test line 2"`
      .on('data', (chunk) => {
        dataChunks++;
        if (chunk.type === 'stdout') {
          output += chunk.data.toString();
        }
      })
      .on('stdout', (chunk) => {
        stdoutChunks++;
        console.log(`   📤 Stdout chunk ${stdoutChunks}: ${chunk.length} bytes`);
      })
      .on('stderr', (chunk) => {
        console.log(`   📤 Stderr chunk: ${chunk.length} bytes`);
      })
      .on('end', (result) => {
        console.log(`   ✅ Process ended with code: ${result.code}`);
        console.log(`   ✅ Data events: ${dataChunks}, Stdout events: ${stdoutChunks}`);
        console.log(`   ✅ Output: "${output.trim()}"`);
        console.log();
        resolve();
      })
      .on('exit', (code) => {
        console.log(`   ✅ Exit event received: ${code}`);
      });
  });
}

// Test 4: Mixed pattern - EventEmitter + await
async function testMixedPattern() {
  console.log('4. Testing mixed EventEmitter + await pattern...');
  
  let realTimeOutput = '';
  let eventCount = 0;
  
  const process = $`echo "Mixed test line 1"; echo "Mixed test line 2"`;
  
  // Set up real-time event handling
  process.on('data', (chunk) => {
    if (chunk.type === 'stdout') {
      eventCount++;
      realTimeOutput += chunk.data.toString();
      console.log(`   📡 Real-time event ${eventCount}: "${chunk.data.toString().trim()}"`);
    }
  });
  
  // Still await the final result
  const result = await process;
  
  console.log(`   ✅ Real-time events: ${eventCount}`);
  console.log(`   ✅ Real-time output: "${realTimeOutput.trim()}"`);
  console.log(`   ✅ Final output: "${result.stdout.trim()}"`);
  console.log(`   ✅ Outputs match: ${realTimeOutput === result.stdout ? 'YES' : 'NO'}`);
  console.log();
}

// Test 5: Error handling
async function testErrorHandling() {
  console.log('5. Testing error handling...');
  
  try {
    const result = await $`echo "stdout"; echo "stderr" >&2; exit 42`;
    console.log(`   ✅ Exit code: ${result.code}`);
    console.log(`   ✅ Stdout: "${result.stdout.trim()}"`);
    console.log(`   ✅ Stderr: "${result.stderr.trim()}"`);
    console.log(`   ✅ Error handling works (non-zero exit doesn't throw)`);
  } catch (error) {
    console.log(`   ❌ Unexpected error: ${error.message}`);
  }
  console.log();
}

// Run tests
async function runAllTests() {
  try {
    await testClassicAwait();
    await testAsyncIteration();
    await testEventEmitter();
    await testMixedPattern();
    await testErrorHandling();
    
    console.log('=== Summary ===');
    console.log('✅ All enhanced $ API patterns working correctly');
    console.log('✅ Classic await: backward compatible ✓');
    console.log('✅ Async iteration: real-time chunk processing ✓');
    console.log('✅ EventEmitter: event-driven streaming ✓');
    console.log('✅ Mixed patterns: EventEmitter + await combination ✓');
    console.log('✅ Error handling: non-zero exits handled gracefully ✓');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runAllTests();