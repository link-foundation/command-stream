#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('Testing child SIGINT handler');

const nodeCode = `
  let cleanupDone = false;
  process.on('SIGINT', () => {
    console.log('CHILD_CLEANUP_START');
    // Simulate cleanup work
    setTimeout(() => {
      cleanupDone = true;
      console.log('CHILD_CLEANUP_DONE');
      process.exit(0); // Exit cleanly after cleanup
    }, 100);
  });
  
  console.log('CHILD_READY');
  
  // Keep process alive
  setTimeout(() => {
    console.log('TIMEOUT_REACHED');
    process.exit(1);
  }, 5000);
`;

const child = spawn('node', ['-e', nodeCode], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
});

console.log('Child spawned with PID:', child.pid);

let stdout = '';
child.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('Stdout:', data.toString().trim());
});

child.stderr.on('data', (data) => {
  console.log('Stderr:', data.toString().trim());
});

// Wait for child to be ready
setTimeout(() => {
  console.log('Sending SIGINT to child...');
  const result = child.kill('SIGINT');
  console.log('Kill result:', result);
}, 500);

child.on('exit', (code, signal) => {
  console.log('Child exited with code:', code, 'signal:', signal);
  console.log('Total stdout:', stdout);
  process.exit(0);
});

// Timeout safety
setTimeout(() => {
  console.log('Timeout reached, force killing...');
  child.kill('SIGKILL');
}, 4000);
