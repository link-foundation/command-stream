#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Isolated StreamEmitter Debug ===');

const cmd = $`echo "test"`;

// Let's debug the listeners map directly
console.log('Initial listeners map:', cmd.listeners);

cmd.on('data', () => console.log('DATA listener called'));
console.log('After data listener:', cmd.listeners);

cmd.on('end', () => console.log('END listener called'));
console.log('After end listener:', cmd.listeners);

cmd.on('exit', () => console.log('EXIT listener called'));
console.log('After exit listener:', cmd.listeners);

// Override emit to debug the listener lookup
const originalEmit = cmd.emit.bind(cmd);
cmd.emit = function (event, ...args) {
  const listeners = this.listeners.get(event);
  console.log(
    `EMIT ${event}: found ${listeners ? listeners.length : 0} listeners`
  );
  if (listeners) {
    console.log(`Listeners array:`, listeners);
    for (let i = 0; i < listeners.length; i++) {
      console.log(`Calling listener ${i} for ${event}`);
      try {
        listeners[i](...args);
        console.log(`Listener ${i} for ${event} completed`);
      } catch (e) {
        console.log(`Listener ${i} for ${event} error:`, e.message);
      }
    }
  }
  return this;
};

console.log('\nStarting command...');
await cmd;
console.log('Command completed');
