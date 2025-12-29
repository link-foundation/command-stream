#!/usr/bin/env node
// Test Claude in JSON streaming mode
import { spawn } from 'child_process';

console.log('=== Claude JSON streaming test ===');

let chunkCount = 0;
const child = spawn('claude', ['hi', '--output-format', 'stream-json'], {
  stdio: 'pipe',
});

child.stdout.on('data', (data) => {
  chunkCount++;
  const str = data.toString();
  console.log(`JSON chunk ${chunkCount}:`, str);

  // Try to parse each line as JSON
  str
    .split('\n')
    .filter((line) => line.trim())
    .forEach((line, i) => {
      try {
        const json = JSON.parse(line);
        console.log(`  Parsed line ${i + 1}:`, json);
      } catch (e) {
        console.log(`  Raw line ${i + 1}:`, line);
      }
    });
});

child.stderr.on('data', (data) => {
  console.log('stderr:', data.toString());
});

child.on('close', (code) => {
  console.log(
    `Process closed with code ${code}, received ${chunkCount} chunks`
  );
});
