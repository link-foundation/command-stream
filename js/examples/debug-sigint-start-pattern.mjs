#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== SIGINT Listeners Start Pattern Debug ===');

function getInternalState() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter((l) => {
    const str = l.toString();
    return (
      str.includes('activeProcessRunners') ||
      str.includes('ProcessRunner') ||
      str.includes('activeChildren')
    );
  });

  return {
    sigintHandlerCount: commandStreamListeners.length,
    totalSigintListeners: sigintListeners.length,
  };
}

function logState(label) {
  const state = getInternalState();
  console.log(
    `${label}: sigintHandlerCount=${state.sigintHandlerCount}, total=${state.totalSigintListeners}`
  );
}

logState('Initial state');

console.log('\nTesting start() pattern like failing test...');
const runner = $`sleep 0.01`;
const promise = runner.start();

logState('After calling start() but before await');

await promise;

logState('After awaiting promise');

console.log('\nTesting direct await pattern...');
const runner2 = $`sleep 0.01`;

logState('Before direct await');

await runner2;

logState('After direct await');

console.log('\nTesting multiple start() calls...');
const runner3 = $`sleep 0.01`;
const runner4 = $`sleep 0.01`;
const promise3 = runner3.start();
const promise4 = runner4.start();

logState('After multiple start() calls');

await Promise.all([promise3, promise4]);

logState('After awaiting all promises');
