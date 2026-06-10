#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Pipeline Debug ===\n');

// Add some debug tracing
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('1. Simple non-pipeline jq test:');
const simple = await $`jq --color-output . <<< '{"test": "simple"}'`;
console.log('Simple result:');
process.stdout.write(simple.stdout);
console.log('Simple raw bytes:', Buffer.from(simple.stdout.slice(0, 30)));

console.log('\n2. Pipeline jq test:');
const pipeline = await $`echo '{"test": "pipeline"}' | jq --color-output .`;
console.log('Pipeline result:');
process.stdout.write(pipeline.stdout);
console.log('Pipeline raw bytes:', Buffer.from(pipeline.stdout.slice(0, 30)));

console.log('\n3. Testing printf pipeline:');
const printf = await $`printf '{"test": "printf"}' | jq --color-output .`;
console.log('Printf result:');
process.stdout.write(printf.stdout);
console.log('Printf raw bytes:', Buffer.from(printf.stdout.slice(0, 30)));
