#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('🧪 Baseline: Claude with stdin (WORKING)');

const claude = spawn(
  'claude',
  ['--output-format', 'stream-json', '--verbose', '--model', 'sonnet'],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
  }
);

let chunkCount = 0;

claude.stdout.on('data', (data) => {
  chunkCount++;
  console.log(`📦 CHUNK ${chunkCount}:`);
  console.log(data.toString());
  console.log('---');
});

claude.stderr.on('data', (data) => {
  console.log('stderr:', data.toString());
});

claude.on('close', (code) => {
  console.log(`✅ Got ${chunkCount} chunks, exit: ${code}`);
});

// Send input and close stdin
claude.stdin.write('hi\n');
claude.stdin.end();
