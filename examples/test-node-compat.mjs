#!/usr/bin/env bun

// Test using Node.js compatible child_process API

import { spawn } from 'child_process';

console.log('=== Testing Node.js Compatible Stream Reading ===\n');

// Test 1: Using Node's spawn
console.log('Test 1: Node.js spawn with on("data") events:');
{
  const start = Date.now();
  let chunkCount = 0;
  
  const proc1 = spawn('bun', ['run', 'examples/emulate-claude-stream.mjs']);
  const proc2 = spawn('jq', ['.'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // Pipe proc1 to proc2
  proc1.stdout.pipe(proc2.stdin);
  
  // Listen for data events
  proc2.stdout.on('data', (chunk) => {
    chunkCount++;
    const elapsed = Date.now() - start;
    const text = chunk.toString();
    const lines = text.split('\n').filter(l => l.trim()).slice(0, 2);
    console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes, first lines:`, lines);
  });
  
  await new Promise(resolve => proc2.on('exit', resolve));
  console.log(`  Total chunks: ${chunkCount}`);
}

// Test 2: Using readable event
console.log('\nTest 2: Using readable event:');
{
  const start = Date.now();
  let chunkCount = 0;
  
  const proc1 = spawn('bun', ['run', 'examples/emulate-claude-stream.mjs']);
  const proc2 = spawn('jq', ['.'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  proc1.stdout.pipe(proc2.stdin);
  
  proc2.stdout.on('readable', () => {
    let chunk;
    while (null !== (chunk = proc2.stdout.read())) {
      chunkCount++;
      const elapsed = Date.now() - start;
      console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes`);
    }
  });
  
  await new Promise(resolve => proc2.on('exit', resolve));
  console.log(`  Total chunks: ${chunkCount}`);
}

// Test 3: Small buffer reads
console.log('\nTest 3: Reading with small buffer size:');
{
  const start = Date.now();
  let chunkCount = 0;
  
  const proc1 = spawn('bun', ['run', 'examples/emulate-claude-stream.mjs']);
  const proc2 = spawn('jq', ['.'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  proc1.stdout.pipe(proc2.stdin);
  
  // Try to read in smaller chunks
  proc2.stdout.on('readable', () => {
    let chunk;
    while (null !== (chunk = proc2.stdout.read(1))) { // Read 1 byte at a time
      chunkCount++;
      const elapsed = Date.now() - start;
      if (chunkCount === 1 || chunkCount % 100 === 0) {
        console.log(`  [${elapsed}ms] Byte ${chunkCount}: ${chunk.toString()}`);
      }
    }
  });
  
  await new Promise(resolve => proc2.on('exit', resolve));
  console.log(`  Total bytes read: ${chunkCount}`);
}