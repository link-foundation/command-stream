#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Property Check Debug ===');

const cmd = $`echo "test"`;

console.log(
  'Object.getOwnPropertyDescriptor(cmd, "stdout"):',
  Object.getOwnPropertyDescriptor(cmd, 'stdout')
);

console.log(
  'Object.getOwnPropertyDescriptor(Object.getPrototypeOf(cmd), "stdout"):',
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(cmd), 'stdout')
);

console.log('cmd.hasOwnProperty("stdout"):', cmd.hasOwnProperty('stdout'));

console.log('cmd.stdout:', cmd.stdout);

console.log('Getting property names:');
console.log('Object.getOwnPropertyNames(cmd):');
Object.getOwnPropertyNames(cmd).forEach((name) => {
  if (name.includes('std')) {
    console.log('  ', name, ':', cmd[name]);
  }
});
