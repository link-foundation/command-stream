#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Getter Internals Debug ===');

// Test virtual command
disableVirtualCommands();
const virtualCmd = $`echo "virtual test"`;
virtualCmd.start();

await new Promise(resolve => setTimeout(resolve, 50));

console.log('\n--- Virtual Command ---');
console.log('virtualCmd.child:', virtualCmd.child);
console.log('virtualCmd.child === null:', virtualCmd.child === null);

// Get the actual getter function
const proto = Object.getPrototypeOf(virtualCmd);
const stdoutDescriptor = Object.getOwnPropertyDescriptor(proto, 'stdout');
console.log('stdout descriptor exists:', !!stdoutDescriptor);
console.log('stdout descriptor.get:', stdoutDescriptor?.get);

// Try calling the getter function directly with explicit context
console.log('\n--- Direct getter call ---');
try {
  const directResult = stdoutDescriptor.get.call(virtualCmd);
  console.log('Direct call result:', directResult);
  console.log('Direct call result === null:', directResult === null);
  console.log('Direct call result === undefined:', directResult === undefined);
} catch (e) {
  console.log('Error calling getter directly:', e);
}

// Check if there are any property descriptors on the instance
console.log('\n--- Instance properties ---');
console.log('Own property descriptor on instance:', 
  Object.getOwnPropertyDescriptor(virtualCmd, 'stdout'));

// Check the prototype chain
console.log('\n--- Prototype chain ---');
let currentProto = virtualCmd;
let level = 0;
while (currentProto && level < 5) {
  console.log(`Level ${level}:`, currentProto.constructor.name);
  const desc = Object.getOwnPropertyDescriptor(currentProto, 'stdout');
  if (desc) {
    console.log(`  Found stdout descriptor at level ${level}:`, desc);
  }
  currentProto = Object.getPrototypeOf(currentProto);
  level++;
}

// Property access
console.log('\n--- Property access ---');
console.log('virtualCmd.stdout:', virtualCmd.stdout);
console.log('virtualCmd["stdout"]:', virtualCmd["stdout"]);

await virtualCmd;