#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Emit Timing Debug ===');

const cmd = $`echo "test"`;

// Track when listeners are called
cmd.on('data', () => console.log('LISTENER: data event at', Date.now()));
cmd.on('end', () => console.log('LISTENER: end event at', Date.now()));
cmd.on('exit', () => console.log('LISTENER: exit event at', Date.now()));

// Override emit to see exact timing
const originalEmit = cmd.emit.bind(cmd);
cmd.emit = function (event, ...args) {
  console.log(`EMIT: ${event} event at ${Date.now()}`);
  return originalEmit(event, ...args);
};

console.log('Starting await at', Date.now());
const result = await cmd;
console.log('Await completed at', Date.now(), 'with code', result.code);

// Wait a bit to see if events come later
setTimeout(() => {
  console.log('Timeout check at', Date.now());
}, 100);
