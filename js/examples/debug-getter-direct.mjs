#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Direct Getter Debug ===');

const cmd = $`echo "test"`;

console.log('Before calling stdout getter');
console.log('cmd.child:', cmd.child);

// Get the getter directly
const proto = Object.getPrototypeOf(cmd);
const descriptor = Object.getOwnPropertyDescriptor(proto, 'stdout');
console.log('Getter descriptor:', descriptor);

console.log('Calling getter directly:');
const result = descriptor.get.call(cmd);
console.log('Direct getter result:', result);

console.log('Calling via property access:');
const result2 = cmd.stdout;
console.log('Property access result:', result2);
