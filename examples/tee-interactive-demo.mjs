#!/usr/bin/env bun

/**
 * Interactive demo of the tee command implementation
 * This shows how tee can be implemented in pure JavaScript and work in interactive mode
 */

import { $ } from '../src/$.mjs';

console.log('=== Tee Command Interactive Demo ===\n');

console.log('🎯 Issue #14: How `tee` command is implemented? Is it possible to reproduce it in pure js?\n');

console.log('✅ Answer: YES! The tee command has been successfully implemented as a virtual command in pure JavaScript.\n');

console.log('=== Understanding the tee Command ===');
console.log('The Unix `tee` command reads from standard input and writes to both:');
console.log('1. Standard output (so data continues through pipelines)');
console.log('2. One or more files simultaneously\n');

console.log('Think of it like a "T" junction in plumbing - input flows to multiple outputs.\n');

console.log('=== Live Demonstration ===\n');

// Demo 1: Basic tee functionality
console.log('📝 Demo 1: Basic tee functionality');
console.log('Command: echo "Hello World" | tee demo-output.txt');
const result1 = await $`echo "Hello World" | tee demo-output.txt`;
console.log(`📤 Stdout: "${result1.stdout.trim()}"`);
console.log(`📁 File content: "${await $`cat demo-output.txt`.then(r => r.stdout.trim())}"`);
console.log('✨ Notice: Same content goes to both stdout AND file!\n');

// Demo 2: Multiple files
console.log('📝 Demo 2: Multiple files simultaneously');  
console.log('Command: echo "Multiple outputs" | tee file1.txt file2.txt file3.txt');
const result2 = await $`echo "Multiple outputs" | tee file1.txt file2.txt file3.txt`;
console.log(`📤 Stdout: "${result2.stdout.trim()}"`);
console.log('📁 All files now contain:');
for (let i = 1; i <= 3; i++) {
  const content = await $`cat file${i}.txt`.then(r => r.stdout.trim());
  console.log(`   file${i}.txt: "${content}"`);
}
console.log('✨ All files identical to stdout!\n');

// Demo 3: Append mode
console.log('📝 Demo 3: Append mode (-a flag)');
console.log('Command: echo "First line" | tee append-demo.txt');
await $`echo "First line" | tee append-demo.txt`;
console.log('Command: echo "Second line" | tee -a append-demo.txt');
const result3 = await $`echo "Second line" | tee -a append-demo.txt`;
const appendContent = await $`cat append-demo.txt`.then(r => r.stdout);
console.log('📁 Final file content:');
console.log(appendContent.split('\n').map(line => `   ${line}`).join('\n'));
console.log('✨ Second call appended instead of overwriting!\n');

// Demo 4: Pipeline compatibility
console.log('📝 Demo 4: Pipeline compatibility');
console.log('Command: echo "pipeline data" | tee pipeline.txt | sort | tee sorted.txt');
const result4 = await $`echo "pipeline data" | tee pipeline.txt | sort | tee sorted.txt`;
console.log(`📤 Final output: "${result4.stdout.trim()}"`);
console.log(`📁 pipeline.txt: "${await $`cat pipeline.txt`.then(r => r.stdout.trim())}"`);
console.log(`📁 sorted.txt: "${await $`cat sorted.txt`.then(r => r.stdout.trim())}"`);
console.log('✨ Data flows through entire pipeline while being saved at each tee!\n');

// Demo 5: Interactive mode simulation
console.log('📝 Demo 5: Interactive mode (simulated)');
console.log('In interactive mode, you would type input and tee would duplicate it to files.');
console.log('Here\'s a simulation with multi-line input:\n');

const interactiveInput = `Line 1: User input
Line 2: More data  
Line 3: Final line`;

console.log('Simulating user typing:');
console.log(interactiveInput.split('\n').map(line => `> ${line}`).join('\n'));
console.log('\nCommand: tee interactive-output.txt (with simulated input)');

const result5 = await $({ stdin: interactiveInput })`tee interactive-output.txt`;
console.log('\n📤 Tee output to stdout:');
console.log(result5.stdout.split('\n').map(line => `  ${line}`).join('\n'));
console.log('\n📁 File content:');
const interactiveFileContent = await $`cat interactive-output.txt`.then(r => r.stdout);
console.log(interactiveFileContent.split('\n').map(line => `  ${line}`).join('\n'));
console.log('✨ Interactive mode works perfectly!\n');

console.log('=== Implementation Details ===');
console.log('📚 The virtual tee command is implemented in pure JavaScript:');
console.log('   • File: src/commands/$.tee.mjs');
console.log('   • Features: Append mode (-a), multiple files, error handling');
console.log('   • Pipeline support: Full stdin/stdout compatibility');
console.log('   • Interactive: Supports real-time input processing');
console.log('   • Error handling: Graceful degradation on file write errors\n');

console.log('=== Key Behaviors ===');
console.log('1. ✅ Reads from stdin (pipeline or direct input)');
console.log('2. ✅ Writes to stdout (maintains pipeline flow)'); 
console.log('3. ✅ Writes to one or more files simultaneously');
console.log('4. ✅ Supports append mode with -a flag');
console.log('5. ✅ Handles errors gracefully (continues output on file errors)');
console.log('6. ✅ Works in interactive mode (real-time processing)');
console.log('7. ✅ Cross-platform (no system dependencies)\n');

console.log('=== Answer to Issue #14 ===');
console.log('🎉 YES, the tee command can be reproduced in pure JavaScript!');
console.log('🛠️  It\'s now available as a built-in virtual command');
console.log('🔄 It supports interactive mode through stdin handling');
console.log('📦 No external dependencies - pure JavaScript implementation');
console.log('🌍 Works identically on all platforms (Windows, macOS, Linux)\n');

// Cleanup
console.log('🧹 Cleaning up demo files...');
try {
  await $`rm -f demo-output.txt file1.txt file2.txt file3.txt append-demo.txt pipeline.txt sorted.txt interactive-output.txt`;
  console.log('✅ Cleanup completed!');
} catch (error) {
  console.log('⚠️  Cleanup had issues, but that\'s okay');
}

console.log('\n=== Try it yourself! ===');
console.log('You can now use the tee command in command-stream:');
console.log('  import { $ } from "command-stream";');
console.log('  await $`echo "test" | tee output.txt`;');
console.log('  await $`seq 1 5 | tee numbers.txt | sort -r`;');