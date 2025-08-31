#!/usr/bin/env node

// Demonstration of the new $({ options }) syntax

import { $ } from '../src/$.mjs';

console.log('=== $({ options }) Syntax Demo ===\n');

// Example 1: Silent operations (no mirror to stdout)
console.log('1. Silent operation:');
const $silent = $({ mirror: false });
const result1 = await $silent`echo "This won't appear in terminal"`;
console.log('   Captured output:', result1.stdout.trim());

// Example 2: Custom stdin
console.log('\n2. Custom stdin:');
const $withInput = $({ stdin: 'Hello from stdin!\n' });
const result2 = await $withInput`cat`;
console.log('   Output:', result2.stdout.trim());

// Example 3: Custom environment
console.log('\n3. Custom environment:');
const $withEnv = $({ 
  env: { ...process.env, DEMO_VAR: 'custom_value' },
  mirror: false 
});
const result3 = await $withEnv`printenv DEMO_VAR`;
console.log('   DEMO_VAR =', result3.stdout.trim());

// Example 4: Custom working directory
console.log('\n4. Custom working directory:');
const $inTmp = $({ cwd: '/tmp', mirror: false });
const result4 = await $inTmp`pwd`;
console.log('   Current directory:', result4.stdout.trim());

// Example 5: Combine multiple options
console.log('\n5. Combined options:');
const $combined = $({
  stdin: 'test data for file',
  cwd: '/tmp',
  mirror: false,
  capture: true
});
const filename = `test-${Date.now()}.txt`;
await $combined`cat > ${filename}`;
const verify = await $({ cwd: '/tmp', mirror: false })`cat ${filename}`;
console.log('   Created file with content:', verify.stdout);
await $({ cwd: '/tmp', mirror: false })`rm ${filename}`;

// Example 6: Reusable configurations
console.log('\n6. Reusable configurations:');
const $debug = $({ 
  env: { ...process.env, DEBUG: 'true' },
  mirror: false 
});

// Run multiple commands with same configuration
const result6a = await $debug`echo "Command 1"`;
console.log('   DEBUG mode result:', result6a.stdout.trim());

const result6b = await $debug`echo "Command 2"`;
console.log('   DEBUG mode result:', result6b.stdout.trim());

const result6c = await $debug`echo "Command 3"`;
console.log('   DEBUG mode result:', result6c.stdout.trim());

// Example 7: Mix with regular $ usage
console.log('\n7. Mixed usage:');
console.log('   Regular $ (with mirror):');
await $`echo "This appears in terminal"`;

console.log('   With options (no mirror):');
await $({ mirror: false })`echo "This doesn't appear"`;

console.log('   Regular $ again:');
await $`echo "Back to normal"`;

console.log('\n=== Demo Complete ===');