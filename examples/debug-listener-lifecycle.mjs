#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Listener Lifecycle Debug ===');

const cmd = $`echo "test"`;

// Track the instance identity
console.log('Command instance ID:', cmd.toString());

// Add listeners
cmd.on('data', () => console.log('DATA listener called'));
cmd.on('end', () => console.log('END listener called'));
cmd.on('exit', () => console.log('EXIT listener called'));

console.log('After adding listeners:', cmd.listeners.size, 'listeners');

// Override _runVirtual to track listeners during execution
const original_runVirtual = cmd._runVirtual;
if (original_runVirtual) {
  cmd._runVirtual = function(...args) {
    console.log('At start of _runVirtual:', this.listeners.size, 'listeners');
    console.log('Instance check:', this === cmd ? 'SAME' : 'DIFFERENT');
    
    const result = original_runVirtual.apply(this, args);
    
    console.log('At end of _runVirtual:', this.listeners.size, 'listeners');
    return result;
  };
}

// Also override emit to see the context
const originalEmit = cmd.emit;
cmd.emit = function(event, ...args) {
  console.log(`Emitting ${event}: instance check:`, this === cmd ? 'SAME' : 'DIFFERENT');
  console.log(`Emitting ${event}: listeners map size:`, this.listeners.size);
  console.log(`Emitting ${event}: has listener for event:`, this.listeners.has(event));
  return originalEmit.call(this, event, ...args);
};

console.log('Starting await...');
await cmd;
console.log('After await:', cmd.listeners.size, 'listeners');
