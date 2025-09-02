#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Execution Path Debug ===');

// Test 1: Check if echo is virtual
console.log('Testing if echo is treated as virtual command...');

const cmd1 = $`echo "test1"`;
console.log('Command spec:', cmd1.spec);
console.log('Command started:', cmd1.started);

// Override the _runVirtual method to see if it's called
const originalRunVirtual = cmd1._runVirtual;
cmd1._runVirtual = function(...args) {
  console.log('_runVirtual called with:', args);
  return originalRunVirtual.apply(this, args);
};

// Override the _doStartAsync to see which path is taken
const originalDoStartAsync = cmd1._doStartAsync;
cmd1._doStartAsync = function(...args) {
  console.log('_doStartAsync called');
  return originalDoStartAsync.apply(this, args);
};

await cmd1;
console.log('Test 1 completed');

// Test 2: Force real command by disabling virtual
console.log('\nTesting with virtual commands disabled...');
import { disableVirtualCommands } from '../src/$.mjs';
disableVirtualCommands();

const cmd2 = $`echo "test2"`;
const originalDoStartAsync2 = cmd2._doStartAsync;
cmd2._doStartAsync = function(...args) {
  console.log('_doStartAsync called for real command');
  return originalDoStartAsync2.apply(this, args);
};

await cmd2;
console.log('Test 2 completed');
