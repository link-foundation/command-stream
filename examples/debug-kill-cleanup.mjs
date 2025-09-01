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

console.log('=== Kill Cleanup Debug ===');

console.log('Initial SIGINT handlers:', getSigintHandlerCount());

// Test killing like the failing test does
const runner = $`seq 1 100`;
const promise = runner.start();

console.log('After starting command:', getSigintHandlerCount(), 'handlers');

// Let it start generating
await new Promise(resolve => setTimeout(resolve, 10));

console.log('Before killing:', getSigintHandlerCount(), 'handlers');

// Kill it before it completes
runner.kill();

console.log('Immediately after kill:', getSigintHandlerCount(), 'handlers');

try {
  await promise;
} catch (e) {
  console.log('Expected error after kill:', e.message);
}

console.log('After awaiting killed promise:', getSigintHandlerCount(), 'handlers');
console.log('runner.finished:', runner.finished);

// Wait a bit more
await new Promise(resolve => setTimeout(resolve, 50));

console.log('After 50ms wait:', getSigintHandlerCount(), 'handlers');

console.log('Test completed.');