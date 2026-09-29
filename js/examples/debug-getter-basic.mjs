#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Basic Getter Debug ===');

const cmd = $`echo "test"`;

console.log('Testing testGetter:');
console.log('cmd.testGetter:', cmd.testGetter);

console.log('Testing stdout getter:');
console.log('cmd.stdout:', cmd.stdout);
