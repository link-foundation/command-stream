#!/usr/bin/env node

import { $ } from '../src/$.mjs';

function getSigintHandlerCount() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter(l => {
    const str = l.toString();
    return str.includes('activeProcessRunners') || 
           str.includes('ProcessRunner') ||
           str.includes('activeChildren');
  });
  return commandStreamListeners.length;
}

console.log('=== Pipeline Cleanup Debug ===');

console.log('Initial SIGINT handlers:', getSigintHandlerCount());

console.log('Running pipeline that should fail...');
try {
  await $`echo "test" | exit 1 | cat`;
} catch (e) {
  console.log('Expected error:', e.message);
}

console.log('Immediately after error:', getSigintHandlerCount(), 'handlers');

// Wait for cleanup to complete like the test does
await new Promise(resolve => setTimeout(resolve, 50));

console.log('After 50ms wait:', getSigintHandlerCount(), 'handlers');

// Try another longer wait
await new Promise(resolve => setTimeout(resolve, 200));

console.log('After 250ms total wait:', getSigintHandlerCount(), 'handlers');

// Show what handlers are still there
const listeners = process.listeners('SIGINT');
listeners.forEach((listener, i) => {
  const str = listener.toString();
  const isCommandStream = str.includes('activeProcessRunners') || 
                         str.includes('ProcessRunner') ||
                         str.includes('activeChildren');
  if (isCommandStream) {
    console.log(`Handler ${i} (COMMAND-STREAM):`, str.substring(0, 100) + '...');
  }
});

console.log('Test completed.');