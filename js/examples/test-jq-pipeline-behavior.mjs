#!/usr/bin/env node

/**
 * Test to demonstrate jq's color behavior in different contexts
 */

import { $ } from '../src/$.mjs';
import { execSync } from 'child_process';

const testJson = '{"message": "hello", "number": 42}';

console.log('='.repeat(60));
console.log('JQ COLOR BEHAVIOR IN DIFFERENT CONTEXTS');
console.log('='.repeat(60));

console.log('\nEnvironment:', {
  'process.stdout.isTTY': process.stdout.isTTY,
  TERM: process.env.TERM,
});

console.log('\n1. JQ IN A PIPELINE (through command-stream):');
console.log('-'.repeat(40));
// When jq is part of a pipeline, it detects it's not writing to a TTY
const pipeResult = await $`echo ${testJson} | jq .`;
console.log('Command: echo ... | jq .');
console.log('Has colors:', /\u001b\[\d+/.test(pipeResult.stdout));
console.log("Reason: jq detects it's in a pipeline, not direct TTY output\n");

console.log('2. JQ DIRECTLY TO TTY (if possible):');
console.log('-'.repeat(40));
try {
  // Try to run jq directly without a pipe
  const directResult = await $`jq . <<< '${testJson}'`;
  console.log('Command: jq . <<< ...');
  console.log('Has colors:', /\u001b\[\d+/.test(directResult.stdout));
  console.log('Output sample:', directResult.stdout.substring(0, 50));
} catch (e) {
  console.log('Could not test direct jq (bash syntax not supported)');
}

console.log('\n3. JQ WITH EXPLICIT COLOR FLAGS:');
console.log('-'.repeat(40));
const colorResult = await $`echo ${testJson} | jq -C .`;
console.log('Command: echo ... | jq -C .');
console.log(
  'Has colors:',
  /\u001b\[\d+/.test(colorResult.stdout),
  '(forced with -C)'
);

const noColorResult = await $`echo ${testJson} | jq -M .`;
console.log('Command: echo ... | jq -M .');
console.log(
  'Has colors:',
  /\u001b\[\d+/.test(noColorResult.stdout),
  '(disabled with -M)'
);

console.log('\n4. DIRECT SHELL EXECUTION (for comparison):');
console.log('-'.repeat(40));
try {
  // Using execSync to run directly in shell
  const shellOutput = execSync(`echo '${testJson}' | jq .`, {
    encoding: 'utf8',
    shell: '/bin/sh',
  });
  console.log('Via execSync with shell:');
  console.log('Has colors:', /\u001b\[\d+/.test(shellOutput));
} catch (e) {
  console.log('Error:', e.message);
}

console.log(`\n${'='.repeat(60)}`);
console.log('SUMMARY:');
console.log("- jq auto-detects when it's in a pipeline vs direct TTY");
console.log('- In pipelines, jq disables colors by default (smart behavior)');
console.log('- This is why the test sees no colors even with isTTY=true');
console.log('- The -C flag forces colors even in pipelines');
console.log('- The -M flag disables colors even with TTY');
console.log('='.repeat(60));
