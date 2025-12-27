#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('Simple pipe test:');

const result = await $`echo hello | cat`;
console.log('Result:', result.stdout);

console.log('\nPipe with jq:');
const result2 = await $`echo '{"x":1}' | jq .`;
console.log('Result:', result2.stdout);
