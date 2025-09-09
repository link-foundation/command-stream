#!/usr/bin/env command-stream

// zx compatibility demonstration script
// This shows how command-stream can run zx-style scripts with superior features

import { $, cd, echo, fs, path, os } from '../src/zx-compat.mjs';

console.log('🚀 command-stream zx compatibility demo');
console.log('=====================================');

// Basic zx-style command execution
console.log('\n📋 Basic commands (zx-style buffered output):');
const result1 = await $`echo "Hello from command-stream zx compatibility!"`;
console.log('stdout:', result1.stdout.trim());
console.log('exitCode:', result1.exitCode);

// Variable interpolation (safe by default)
console.log('\n🔒 Variable interpolation (safe by default):');
const message = 'Hello, safe interpolation!';
const result2 = await $`echo ${message}`;
console.log('stdout:', result2.stdout.trim());

// Error handling (zx-style exceptions)
console.log('\n❌ Error handling (throws by default):');
try {
  await $`exit 1`;
} catch (error) {
  console.log('Caught error:', error.message);
  console.log('Exit code:', error.exitCode);
}

// nothrow mode
console.log('\n🚫 Nothrow mode:');
const result3 = await $.nothrow`exit 1`;
console.log('exitCode:', result3.exitCode);
console.log('Did not throw');

// cd function
console.log('\n📁 Directory navigation:');
console.log('Current dir:', process.cwd());
cd('..');
console.log('After cd(..):', process.cwd());
cd('gh-issue-solver-1757444287331'); // Go back to the project dir

// echo function
console.log('\n📢 Echo function:');
await echo('This is from the echo function');

// Built-in commands showcase (command-stream advantage!)
console.log('\n⚡ Built-in commands (no system dependencies!):');
try {
  // These work even without system versions installed
  const lsResult = await $`ls -la README.md`;
  console.log('Built-in ls works:', lsResult.stdout.includes('README.md'));
} catch (e) {
  console.log('Note: built-in ls requires specific setup');
}

console.log('\n✅ Demo complete! command-stream provides zx compatibility with superior features:');
console.log('   • Built-in commands (18 vs 0)');
console.log('   • Real-time streaming available (vs buffered only)'); 
console.log('   • Smaller bundle size (~20KB vs ~400KB+)');
console.log('   • EventEmitter pattern available');
console.log('   • Async iteration available');
console.log('   • Better signal handling');