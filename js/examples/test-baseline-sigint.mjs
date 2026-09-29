#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('Testing baseline SIGINT behavior');

const child = spawn('sh', ['-c', 'echo "BASELINE_START" && sleep 30'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
});

console.log('Child spawned with PID:', child.pid);

let stdout = '';
child.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('Received stdout:', JSON.stringify(data.toString()));
});

// Wait for output
setTimeout(() => {
  console.log('Sending SIGINT to child...');
  const result = child.kill('SIGINT');
  console.log('Kill result:', result);
}, 500);

// Wait for exit
child.on('exit', (code, signal) => {
  console.log('Child exited with code:', code, 'signal:', signal);
  console.log('Total stdout:', stdout);
  process.exit(0);
});

// Timeout safety
setTimeout(() => {
  console.log('Timeout reached, force killing...');
  child.kill('SIGKILL');
}, 5000);
