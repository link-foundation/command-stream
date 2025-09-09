#!/usr/bin/env node

// Example demonstrating the new dev mode functionality

import { $ } from '../src/$.mjs';

console.log('🚀 Dev Mode Demo');
console.log('================\n');

console.log('1. Basic dev mode (file watching):');
console.log('   $.dev()  // Starts file watching\n');

console.log('2. Dev mode with REPL:');
console.log('   $.dev({ repl: true })  // Starts interactive REPL\n');

console.log('3. Custom watch patterns:');
console.log('   $.dev({ watch: ["src/**/*.js", "test/**/*.js"] })\n');

console.log('4. CLI usage:');
console.log('   npx command-stream repl  // Start REPL directly');
console.log('   npx command-stream dev   // Start dev mode');

console.log('\n📝 Try these commands:');
console.log('   node examples/dev-mode-demo.mjs');
console.log('   npx command-stream repl');
console.log('   npx command-stream dev');