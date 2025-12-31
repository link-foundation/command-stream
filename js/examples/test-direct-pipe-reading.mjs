#!/usr/bin/env bun

// Test different ways to read from piped processes

console.log('=== Testing Direct Pipe Reading Methods ===\n');

// Method 1: Two separate processes with manual pipe
console.log('Method 1: Manual pipe connection with for await:');
{
  const proc1 = Bun.spawn(
    ['bun', 'run', 'js/examples/emulate-claude-stream.mjs'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  const proc2 = Bun.spawn(['jq', '.'], {
    stdin: proc1.stdout,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const start = Date.now();
  let chunkCount = 0;

  // Read using for await
  for await (const chunk of proc2.stdout) {
    chunkCount++;
    const elapsed = Date.now() - start;
    console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes`);
  }

  await proc1.exited;
  await proc2.exited;
}

// Method 2: Try reading proc1.stdout directly while it's also piped
console.log('\nMethod 2: Read from first process while piped:');
{
  const proc1 = Bun.spawn(
    ['bun', 'run', 'js/examples/emulate-claude-stream.mjs'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  const start = Date.now();
  let chunkCount = 0;

  // Try to read proc1 stdout directly (even though it will be piped)
  for await (const chunk of proc1.stdout) {
    chunkCount++;
    const elapsed = Date.now() - start;
    const text = Buffer.from(chunk).toString().trim();
    console.log(`  [${elapsed}ms] From proc1: ${text}`);
  }

  await proc1.exited;
}

// Method 3: Use tee to split the stream
console.log('\nMethod 3: Using tee() to split stream:');
{
  const proc1 = Bun.spawn(
    ['bun', 'run', 'js/examples/emulate-claude-stream.mjs'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  // Use ReadableStream.tee() to split the stream
  const [stream1, stream2] = proc1.stdout.tee();

  const proc2 = Bun.spawn(['jq', '.'], {
    stdin: stream2,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const start = Date.now();
  let chunkCount = 0;

  // Read from the tee'd stream
  for await (const chunk of stream1) {
    chunkCount++;
    const elapsed = Date.now() - start;
    const text = Buffer.from(chunk).toString().trim();
    console.log(`  [${elapsed}ms] From tee: ${text}`);
  }

  await proc1.exited;
  await proc2.exited;
}

// Method 4: What if we DON'T pipe and just run the full command?
console.log('\nMethod 4: Full pipeline as single command:');
{
  const proc = Bun.spawn(
    ['sh', '-c', 'bun run js/examples/emulate-claude-stream.mjs | jq .'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  const start = Date.now();
  let chunkCount = 0;

  for await (const chunk of proc.stdout) {
    chunkCount++;
    const elapsed = Date.now() - start;
    console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes`);
  }

  await proc.exited;
}
