#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

console.log('=== Testing watch mode ===\n');

// Start the watch process in background
console.log('Starting watch process...');
const watchProcess = spawn(
  'node',
  ['claude-profiles.mjs', '--watch', 'test-watch', '--verbose'],
  {
    stdio: 'pipe',
    env: process.env,
  }
);

let output = '';
watchProcess.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);
});

watchProcess.stderr.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stderr.write(text);
});

// Wait for initial save
console.log('\nWaiting for initial state...');
await new Promise((resolve) => setTimeout(resolve, 3000));

// Make a change to trigger save
console.log('\nMaking a change to .claude.json...');
const claudeJsonPath = path.join(os.homedir(), '.claude.json');
try {
  const content = await fs.readFile(claudeJsonPath, 'utf8');
  const json = JSON.parse(content);
  json.test_timestamp = new Date().toISOString();
  await fs.writeFile(claudeJsonPath, JSON.stringify(json, null, 2));
  console.log('✅ Modified .claude.json');
} catch (error) {
  console.error('Failed to modify .claude.json:', error.message);
}

// Wait for save detection
console.log('\nWaiting for change detection...');
await new Promise((resolve) => setTimeout(resolve, 8000));

// Check if save was detected
if (output.includes('Profile auto-saved')) {
  console.log('\n✅ Auto-save detected and completed');
} else {
  console.log('\n⚠️ Auto-save not detected in output');
}

// Make another change within throttle window
console.log('\nMaking another change (within 30s throttle)...');
try {
  const content = await fs.readFile(claudeJsonPath, 'utf8');
  const json = JSON.parse(content);
  json.test_timestamp2 = new Date().toISOString();
  await fs.writeFile(claudeJsonPath, JSON.stringify(json, null, 2));
  console.log('✅ Modified .claude.json again');
} catch (error) {
  console.error('Failed to modify .claude.json:', error.message);
}

// Wait to see throttling
console.log('\nWaiting to observe throttling...');
await new Promise((resolve) => setTimeout(resolve, 5000));

// Send SIGINT to test graceful shutdown
console.log('\nSending SIGINT for graceful shutdown...');
watchProcess.kill('SIGINT');

// Wait for process to exit
await new Promise((resolve) => {
  watchProcess.on('exit', (code) => {
    console.log(`\nWatch process exited with code: ${code}`);
    resolve();
  });
});

// Clean up test changes
console.log('\nCleaning up test changes...');
try {
  const content = await fs.readFile(claudeJsonPath, 'utf8');
  const json = JSON.parse(content);
  delete json.test_timestamp;
  delete json.test_timestamp2;
  await fs.writeFile(claudeJsonPath, JSON.stringify(json, null, 2));
  console.log('✅ Cleaned up .claude.json');
} catch (error) {
  console.error('Failed to clean up:', error.message);
}

console.log('\n=== Watch mode test complete ===');
