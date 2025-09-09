#!/usr/bin/env node
/**
 * Command-Stream Runtime Comparison Index
 * 
 * Interactive menu to run specific comparison examples or all at once.
 * Demonstrates command-stream's identical behavior across Node.js and Bun.js
 */

import { $ } from '../../src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';

const examples = [
  { file: '01-basic-await-comparison.mjs', name: 'Basic Await Pattern', description: 'Classic await syntax and error handling' },
  { file: '02-async-iteration-comparison.mjs', name: 'Async Iteration', description: 'Real-time streaming with for-await loops' },
  { file: '03-eventemitter-comparison.mjs', name: 'EventEmitter Pattern', description: 'Event-driven command execution' },
  { file: '04-streaming-stdin-comparison.mjs', name: 'Streaming STDIN', description: 'Real-time stdin control and piping' },
  { file: '05-streaming-buffers-comparison.mjs', name: 'Buffer Access', description: 'Binary data and buffer interfaces' },
  { file: '07-builtin-filesystem-comparison.mjs', name: 'Built-in File System', description: 'Cross-platform file operations' },
  { file: '10-virtual-basic-comparison.mjs', name: 'Virtual Commands', description: 'JavaScript functions as shell commands' },
  { file: '15-pipeline-mixed-comparison.mjs', name: 'Mixed Pipelines', description: 'System + Built-in + Virtual command pipelines' },
  { file: '19-execution-sync-comparison.mjs', name: 'Synchronous Execution', description: 'Sync vs async execution modes' },
  { file: '23-security-quoting-comparison.mjs', name: 'Security & Quoting', description: 'Smart auto-quoting and injection protection' },
  { file: 'run-all-comparisons.mjs', name: 'Run All Tests', description: 'Execute complete test suite' }
];

console.log('🚀 Command-Stream: Node.js vs Bun.js Ultimate Comparison');
console.log(`Currently running with: ${runtime}`);
console.log('=' .repeat(70));

console.log('\n📋 Available Comparison Examples:\n');

examples.forEach((example, index) => {
  console.log(`${(index + 1).toString().padStart(2)}. ${example.name}`);
  console.log(`    ${example.description}`);
  console.log(`    File: ${example.file}`);
  console.log('');
});

console.log('🎯 Key Features Demonstrated:');
console.log('✅ Identical API behavior across runtimes');
console.log('✅ Cross-platform built-in commands'); 
console.log('✅ Revolutionary virtual commands system');
console.log('✅ Advanced pipeline mixing capabilities');
console.log('✅ Real-time streaming interfaces');
console.log('✅ Comprehensive security features');
console.log('✅ Multiple execution patterns');
console.log('✅ Unified error handling');

console.log('\n🔥 Revolutionary Features:');
console.log('• Virtual Commands - First library to offer JavaScript functions as shell commands');
console.log('• Mixed Pipelines - System + Built-in + Virtual commands in same pipeline');
console.log('• Real-time Streaming - Live async iteration over command output');
console.log('• Smart Security - Auto-quoting prevents shell injection');
console.log('• Cross-runtime - Identical behavior in Node.js and Bun');

console.log('\n🚀 To run a specific example:');
console.log(`   ${runtime.toLowerCase()} examples/comparisons/[filename]`);

console.log('\n🏃 To run all comparisons:');
console.log(`   ${runtime.toLowerCase()} examples/comparisons/run-all-comparisons.mjs`);

console.log('\n📊 Runtime Comparison Benefits:');
console.log(`• ${runtime === 'Bun' ? '⚡ Faster' : '🔧 Stable'}: ${runtime} provides ${runtime === 'Bun' ? 'superior performance' : 'mature ecosystem compatibility'}`);
console.log(`• 🔄 Switch freely: Change runtime without changing code`);
console.log(`• 📦 Deploy anywhere: Same codebase runs in both environments`);
console.log(`• 🎯 Choose optimal: Pick runtime based on specific needs`);

console.log('\n' + '=' .repeat(70));
console.log(`✨ Ready to explore command-stream's power in ${runtime}!`);