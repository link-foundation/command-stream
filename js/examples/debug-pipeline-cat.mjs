#!/usr/bin/env node
// Debug pipeline with cat

import { $ } from '../src/$.mjs';

process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('=== Debug pipeline with cat ===');

console.log('1. Test simple echo:');
const r1 = await $`echo "test"`;
console.log('Simple echo result:', JSON.stringify(r1.stdout));

console.log('2. Test simple cat with stdin:');
const r2 = $`cat`;
r2.options.stdin = 'test';
await r2;
console.log('Cat with stdin result:', JSON.stringify(r2.result.stdout));

console.log('3. Test pipeline echo | cat:');
const r3 = await $`echo "test" | cat`;
console.log('Pipeline result:', JSON.stringify(r3.stdout));

console.log('4. Test pipeline echo | cat | cat:');
const r4 = await $`echo "test" | cat | cat`;
console.log('Double pipeline result:', JSON.stringify(r4.stdout));

console.log('=== Complete ===');
