#!/usr/bin/env node

// Multiple ping streaming examples showing different patterns

import { $ } from '../src/$.mjs';

console.log('=== Ping Streaming Examples ===\n');

// Example 1: Basic streaming with timestamps
console.log('1. Basic streaming with timestamps:');
console.log('   Running ping -c 5 google.com...\n');

try {
  for await (const chunk of $`ping -c 5 google.com`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        const time = new Date().toLocaleTimeString();
        console.log(`   [${time}] ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: Filtering specific ping responses
console.log('2. Filtering only ping replies (no summary):');
console.log('   Running ping -c 3 1.1.1.1...\n');

try {
  for await (const chunk of $`ping -c 3 1.1.1.1`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      // Only show lines with ping replies (contain "bytes from")
      if (output.includes('bytes from')) {
        console.log(`   📡 ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Count and track responses
console.log('3. Counting responses with statistics:');
console.log('   Running ping -c 4 8.8.8.8...\n');

let responseCount = 0;
let totalTime = 0;
const responses = [];

try {
  for await (const chunk of $`ping -c 4 8.8.8.8`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      
      if (output.includes('bytes from')) {
        responseCount++;
        
        // Extract response time
        const timeMatch = output.match(/time=([0-9.]+)/);
        if (timeMatch) {
          const responseTime = parseFloat(timeMatch[1]);
          responses.push(responseTime);
          totalTime += responseTime;
          
          console.log(`   Response #${responseCount}: ${responseTime}ms`);
        }
      }
      
      // Show final statistics
      if (output.includes('packets transmitted')) {
        console.log('\n   📊 Final Statistics:');
        console.log(`   • Total responses: ${responseCount}`);
        if (responses.length > 0) {
          console.log(`   • Average time: ${(totalTime / responses.length).toFixed(2)}ms`);
          console.log(`   • Min time: ${Math.min(...responses).toFixed(2)}ms`);
          console.log(`   • Max time: ${Math.max(...responses).toFixed(2)}ms`);
        }
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Using custom options with streaming
console.log('4. Silent streaming (no mirror to terminal):');
console.log('   Running ping -c 3 127.0.0.1 with mirror: false...\n');

try {
  const $silent = $({ mirror: false });
  
  for await (const chunk of $silent`ping -c 3 127.0.0.1`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        // Custom formatting since we're not mirroring
        console.log(`   🔇 Silent: ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n=== All examples completed ===');