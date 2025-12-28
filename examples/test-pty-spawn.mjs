#!/usr/bin/env bun

// Test if Bun has PTY support or if we can fake it

console.log('=== Testing PTY/TTY Solutions ===\n');

// Check if Bun has PTY support
console.log('Checking Bun APIs for PTY support:');
console.log(
  '  Bun.spawn options:',
  Object.keys(Bun.spawn(['echo'], { stdout: 'pipe' }))
);

// Try using script command as a PTY wrapper
console.log('\nUsing script command as PTY wrapper:');
{
  const start = Date.now();
  let chunkCount = 0;

  // Use script to create a PTY
  // -q: quiet mode (no script started/done messages)
  // /dev/null: don't save typescript file
  const proc = Bun.spawn(
    [
      'script',
      '-q',
      '/dev/null',
      'sh',
      '-c',
      'bun run examples/emulate-claude-stream.mjs | jq .',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        // Force color/TTY detection
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    }
  );

  for await (const chunk of proc.stdout) {
    chunkCount++;
    const elapsed = Date.now() - start;
    const text = Buffer.from(chunk).toString();

    // Script adds control characters, let's see what we get
    const cleanText = text.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI codes
    const lines = cleanText
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 2);

    console.log(`  [${elapsed}ms] Chunk ${chunkCount}: ${chunk.length} bytes`);
    if (lines.length > 0) {
      console.log(`    First lines:`, lines);
    }
  }

  await proc.exited;
  console.log(`  Total chunks: ${chunkCount}`);
}

// Alternative: Try to use COLUMNS/LINES env vars to fake TTY
console.log('\nTrying with TTY environment variables:');
{
  const start = Date.now();
  let chunkCount = 0;

  const proc = Bun.spawn(
    ['sh', '-c', 'bun run examples/emulate-claude-stream.mjs | jq .'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        COLUMNS: '80',
        LINES: '24',
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    }
  );

  for await (const chunk of proc.stdout) {
    chunkCount++;
    const elapsed = Date.now() - start;
    const text = Buffer.from(chunk).toString();
    const lines = text
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 2);

    console.log(`  [${elapsed}ms] Chunk ${chunkCount}: first lines:`, lines);
  }

  await proc.exited;
  console.log(`  Total chunks: ${chunkCount}`);
}
