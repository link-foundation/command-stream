#!/usr/bin/env bun

// Test different ways to read from process streams in Bun

console.log('=== Testing Different Stream Reading Methods ===\n');

// Method 1: Using getReader() with ReadableStream API
console.log('Method 1: ReadableStream getReader():');
{
  const proc = Bun.spawn(['sh', '-c', 'bun run examples/emulate-claude-stream.mjs | jq .'], {
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const start = Date.now();
  const reader = proc.stdout.getReader();
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount++;
      const elapsed = Date.now() - start;
      console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${value.length} bytes`);
    }
  } finally {
    reader.releaseLock();
  }
  await proc.exited;
}

// Method 2: Using readable() if available
console.log('\nMethod 2: Check if readable() method exists:');
{
  const proc = Bun.spawn(['sh', '-c', 'echo "test"'], {
    stdout: 'pipe'
  });
  
  console.log('  stdout methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(proc.stdout)));
  await proc.exited;
}

// Method 3: Try using Bun.file or other APIs
console.log('\nMethod 3: Using Response API:');
{
  const proc = Bun.spawn(['sh', '-c', 'bun run examples/emulate-claude-stream.mjs | jq .'], {
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const start = Date.now();
  
  // Try to read as a Response stream
  const response = new Response(proc.stdout);
  const reader = response.body.getReader();
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount++;
      const elapsed = Date.now() - start;
      console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${value.length} bytes`);
    }
  } finally {
    reader.releaseLock();
  }
  await proc.exited;
}

// Method 4: Try smaller reads with setImmediate/setTimeout
console.log('\nMethod 4: Polling with small timeout:');
{
  const proc = Bun.spawn(['sh', '-c', 'bun run examples/emulate-claude-stream.mjs | jq .'], {
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const start = Date.now();
  const reader = proc.stdout.getReader();
  let chunkCount = 0;

  const readWithTimeout = async () => {
    while (true) {
      try {
        // Try to read with a promise race against a timeout
        const readPromise = reader.read();
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ done: false, timeout: true }), 10));
        
        const result = await Promise.race([readPromise, timeoutPromise]);
        
        if (result.timeout) {
          // No data yet, continue
          continue;
        }
        
        if (result.done) break;
        
        chunkCount++;
        const elapsed = Date.now() - start;
        console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${result.value.length} bytes`);
      } catch (e) {
        break;
      }
    }
  };

  await readWithTimeout();
  reader.releaseLock();
  await proc.exited;
}

// Method 5: Direct file descriptor access (if possible)
console.log('\nMethod 5: Check proc.stdout properties:');
{
  const proc = Bun.spawn(['echo', 'test'], {
    stdout: 'pipe'
  });
  
  console.log('  stdout type:', proc.stdout.constructor.name);
  console.log('  stdout properties:', Object.keys(proc.stdout));
  
  await proc.exited;
}