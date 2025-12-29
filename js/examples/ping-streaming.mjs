#!/usr/bin/env node

// Streaming ping example - shows real-time output as it arrives

import { $ } from '../js/src/$.mjs';

console.log('=== Real-time Ping Streaming Example ===');
console.log('Press CTRL+C to stop the ping...\n');

try {
  // Stream ping output in real-time
  for await (const chunk of $`ping -c 10 8.8.8.8`.stream()) {
    if (chunk.type === 'stdout') {
      // Process each line of ping output as it arrives
      const output = chunk.data.toString().trim();
      if (output) {
        const timestamp = new Date().toISOString().substring(11, 23);
        console.log(`[${timestamp}] ${output}`);

        // Parse ping statistics if available
        if (output.includes('time=')) {
          const timeMatch = output.match(/time=([0-9.]+)/);
          if (timeMatch) {
            const responseTime = parseFloat(timeMatch[1]);
            const status =
              responseTime < 50
                ? '🟢 Fast'
                : responseTime < 100
                  ? '🟡 Normal'
                  : '🔴 Slow';
            console.log(`    └─ Response time: ${responseTime}ms ${status}`);
          }
        }
      }
    } else if (chunk.type === 'stderr') {
      // Handle any error output
      console.error('Error:', chunk.data.toString().trim());
    }
  }
} catch (error) {
  if (error.code === 130) {
    console.log('\n✓ Ping interrupted by user (CTRL+C)');
  } else {
    console.error('\n✗ Ping failed:', error.message);
  }
}

console.log('\n=== Ping streaming completed ===');
