#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Issue #43: Stream Output Handling Test ===\n');

// Test 1: Basic streaming with real-time output
console.log('Test 1: Basic real-time streaming');
const startTime = Date.now();
try {
  const cmd = $`sh -c 'for i in 1 2 3; do echo "Output $i"; sleep 0.5; done'`;
  let chunkCount = 0;
  
  for await (const chunk of cmd.stream()) {
    chunkCount++;
    const elapsed = Date.now() - startTime;
    console.log(`[${elapsed}ms] Chunk ${chunkCount} - Type: ${chunk.type}, Data: ${chunk.data?.toString().trim()}`);
  }
  console.log('✅ Test 1 passed\n');
} catch (error) {
  console.error('❌ Test 1 failed:', error.message);
}

// Test 2: Long-running process monitoring
console.log('Test 2: Long-running process with tail -f behavior');
try {
  // Create a temporary file and simulate tail -f behavior
  const filename = `/tmp/test-streaming-${Date.now()}.log`;
  
  // Start background process writing to file
  const writer = $`sh -c 'for i in {1..10}; do echo "Line $i $(date)" >> ${filename}; sleep 0.2; done'`;
  writer; // Start it but don't await
  
  // Wait a bit for file to be created
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const tailCmd = $`tail -f ${filename}`;
  let lineCount = 0;
  const maxLines = 5; // Don't run forever
  
  for await (const chunk of tailCmd.stream()) {
    if (chunk.type === 'stdout') {
      lineCount++;
      console.log(`Line ${lineCount}: ${chunk.data.toString().trim()}`);
      
      if (lineCount >= maxLines) {
        break; // Break early to test streaming interruption
      }
    }
  }
  
  console.log('✅ Test 2 passed - streamed real-time output\n');
} catch (error) {
  console.error('❌ Test 2 failed:', error.message);
}

// Test 3: Build process simulation
console.log('Test 3: Build process with progress indicators');
try {
  const buildCmd = $`bash -c 'echo "Starting build..."; for i in {1..5}; do echo "Building component $i/5"; sleep 0.3; done; echo "Build complete!"'`;
  let buildStep = 0;
  
  for await (const chunk of buildCmd.stream()) {
    if (chunk.type === 'stdout') {
      buildStep++;
      const output = chunk.data.toString().trim();
      console.log(`[Build Step ${buildStep}] ${output}`);
    }
  }
  console.log('✅ Test 3 passed\n');
} catch (error) {
  console.error('❌ Test 3 failed:', error.message);
}

// Test 4: Watch-like command simulation  
console.log('Test 4: Watch-like continuous output');
try {
  const watchCmd = $`bash -c 'for i in 1 2 3; do echo "Update $i at $(date)"; sleep 0.4; done'`;
  let updateCount = 0;
  
  for await (const chunk of watchCmd.stream()) {
    if (chunk.type === 'stdout') {
      updateCount++;
      console.log(`Update ${updateCount}: ${chunk.data.toString().trim()}`);
    }
  }
  console.log('✅ Test 4 passed\n');
} catch (error) {
  console.error('❌ Test 4 failed:', error.message);
}

console.log('=== Issue #43 Tests Complete ===');