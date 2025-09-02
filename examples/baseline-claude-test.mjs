#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('🧪 Baseline Claude test with spawn');

const claude = spawn('claude', ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet']);

let chunkCount = 0;
let totalOutput = '';

claude.stdout.on('data', (data) => {
  chunkCount++;
  const str = data.toString();
  console.log(`📦 Chunk ${chunkCount} (${str.length} bytes):`);
  console.log(str);
  console.log('---');
  totalOutput += str;
});

claude.stderr.on('data', (data) => {
  console.log('stderr:', data.toString());
});

claude.on('close', (code) => {
  console.log(`✅ Process closed: ${chunkCount} chunks, ${totalOutput.length} total bytes, exit code ${code}`);
});

claude.on('error', (error) => {
  console.log('❌ Spawn error:', error.message);
});

// Timeout after 20 seconds
setTimeout(() => {
  console.log(`⏰ Timeout: ${chunkCount} chunks so far`);
  claude.kill();
}, 20000);