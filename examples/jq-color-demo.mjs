#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== jq Color Output Demo ===\n');

const testJson = '{"message": "Hello World", "number": 42, "active": true, "nested": {"data": [1, 2, 3], "flag": false}}';

console.log('This demo shows how to get colored jq output with command-stream.\n');

console.log('1. Default behavior (mirror: true means output appears automatically):');
console.log('   Code: await $`echo ${testJson} | jq .`');
console.log('   Output:');
await $`echo ${testJson} | jq .`;

console.log('\n2. Force colors even in non-TTY environments with -C flag:');
console.log('   Code: await $`echo ${testJson} | jq -C .`');
console.log('   Output (with ANSI color codes):');
await $`echo ${testJson} | jq -C .`;

console.log('\n3. Extract specific field with colors:');
console.log('   Code: await $`echo ${testJson} | jq -C .nested`');
console.log('   Output:');
await $`echo ${testJson} | jq -C .nested`;

console.log('\n4. No need for console.log - output is automatically mirrored!');
console.log('   The beauty of command-stream is that with default settings,');
console.log('   you get shell-like behavior: output appears immediately.');

console.log('\n5. Capture-only mode (no automatic output):');
console.log('   Code: const result = await $({ mirror: false })`echo ${testJson} | jq -C .message`');
const result = await $({ mirror: false })`echo ${testJson} | jq -C .message`;
console.log('   Captured result:', JSON.stringify(result.stdout.trim()));

console.log('\n6. Best of both worlds (mirror + capture):');
console.log('   Code: const result = await $`echo ${testJson} | jq -C -r .message`');
const result2 = await $`echo ${testJson} | jq -C -r .message`;
console.log('   Also captured:', JSON.stringify(result2.stdout.trim()));

console.log('\n✅ Summary:');
console.log('- Use jq -C for forced colors (works in any environment)');  
console.log('- Default mirror:true means no manual console.log needed');
console.log('- Colors work great with command-stream piping');
console.log('- In real TTY environments, jq colors automatically!');