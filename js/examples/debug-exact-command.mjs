#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Testing Exact Command from jq-colors-streaming.mjs ===\n');

const coloredCmd = $`printf '{"name":"Alice","status":"active","score":95}\n{"name":"Bob","status":"inactive","score":87}\n{"name":"Carol","status":"active","score":92}\n' | jq --color-output .`;

console.log('Raw streaming output:');
coloredCmd.on('stdout', (chunk) => {
  console.log('CHUNK TYPE:', typeof chunk, chunk.constructor.name);
  console.log('CHUNK BYTES (first 50):', Buffer.from(chunk.slice(0, 50)));
  console.log('CHUNK CONTENT:');
  process.stdout.write('>>> ');
  process.stdout.write(chunk);
  console.log('<<<');
});

const result = await coloredCmd;

console.log('\nFinal result:');
console.log('RESULT TYPE:', typeof result.stdout);
console.log(
  'RESULT BYTES (first 50):',
  Buffer.from(result.stdout.slice(0, 50))
);
console.log('RESULT CONTENT:');
process.stdout.write(result.stdout);
