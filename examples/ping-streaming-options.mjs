#!/usr/bin/env node

// Ping streaming using $({ options }) syntax

import { $ } from '../src/$.mjs';

console.log('=== Ping Streaming with $({ options }) Syntax ===\n');

// Example 1: Silent streaming (no mirror)
console.log('1. Silent streaming (mirror: false):');
const $silent = $({ mirror: false });

try {
  for await (const chunk of $silent`ping -c 3 8.8.8.8`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        console.log(`   🔇 Silent: ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: Custom stdin with streaming
console.log('2. Streaming with custom stdin:');
const $withStdin = $({ stdin: 'Hello\nWorld\n', mirror: false });

try {
  for await (const chunk of $withStdin`cat -n`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        console.log(`   📝 Input: ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Capture and stream combination
console.log('3. Capture enabled with streaming:');
const $capture = $({ capture: true, mirror: false });

let capturedOutput = '';
try {
  const runner = $capture`echo -e "Line 1\nLine 2\nLine 3"`;
  
  for await (const chunk of runner.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString();
      capturedOutput += output;
      console.log(`   📦 Streaming: ${output.trim()}`);
    }
  }
  
  const result = await runner;
  console.log(`   💾 Final captured: "${result.stdout.trim()}"`);
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Multiple instances with different options
console.log('4. Multiple configured instances:');
const $quiet = $({ mirror: false });
const $verbose = $({ mirror: true });

try {
  console.log('   Running quiet ping...');
  for await (const chunk of $quiet`ping -c 2 127.0.0.1`.stream()) {
    if (chunk.type === 'stdout' && chunk.data.toString().includes('bytes from')) {
      console.log(`   🤫 Quiet result: ping successful`);
    }
  }
  
  console.log('\n   Running verbose ping...');
  let count = 0;
  for await (const chunk of $verbose`ping -c 2 127.0.0.1`.stream()) {
    if (chunk.type === 'stdout' && chunk.data.toString().includes('bytes from')) {
      count++;
      console.log(`   📢 Verbose: packet #${count} received`);
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n=== All $({ options }) streaming examples completed ===');