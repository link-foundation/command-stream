#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Map Methods Debug ===');

const cmd = $`echo "test"`;

// Override Map methods to track modifications
const originalClear = cmd.listeners.clear.bind(cmd.listeners);
const originalDelete = cmd.listeners.delete.bind(cmd.listeners);
const originalSet = cmd.listeners.set.bind(cmd.listeners);

cmd.listeners.clear = function () {
  console.log('LISTENERS MAP CLEARED!');
  const stack = new Error().stack;
  console.log('Stack trace:', stack.split('\n').slice(1, 5).join('\n'));
  return originalClear();
};

cmd.listeners.delete = function (key) {
  console.log('LISTENERS MAP DELETE:', key);
  const stack = new Error().stack;
  console.log('Stack trace:', stack.split('\n').slice(1, 3).join('\n'));
  return originalDelete(key);
};

cmd.listeners.set = function (key, value) {
  console.log('LISTENERS MAP SET:', key, 'with', value.length, 'listeners');
  return originalSet(key, value);
};

cmd.on('data', () => console.log('DATA listener called'));
cmd.on('end', () => console.log('END listener called'));
cmd.on('exit', () => console.log('EXIT listener called'));

console.log('Starting await...');
await cmd;
console.log('Completed await');
