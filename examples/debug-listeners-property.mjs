#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Listeners Property Debug ===');

const cmd = $`echo "test"`;

// Override the listeners property to track modifications
let _listeners = cmd.listeners;
Object.defineProperty(cmd, 'listeners', {
  get() {
    return _listeners;
  },
  set(newValue) {
    console.log('LISTENERS PROPERTY SET!');
    console.log('Old value size:', _listeners ? _listeners.size : 'undefined');
    console.log('New value size:', newValue ? newValue.size : 'undefined');
    
    // Get stack trace to see who's setting the property
    const stack = new Error().stack;
    console.log('Stack trace:', stack.split('\n').slice(1, 5).join('\n'));
    
    _listeners = newValue;
  }
});

cmd.on('data', () => console.log('DATA listener called'));
cmd.on('end', () => console.log('END listener called'));
cmd.on('exit', () => console.log('EXIT listener called'));

console.log('Starting await...');
await cmd;
console.log('Completed await');
