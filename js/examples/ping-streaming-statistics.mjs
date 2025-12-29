#!/usr/bin/env node

// Counting responses with statistics

import { $ } from '../js/src/$.mjs';

console.log('Counting responses with statistics:');
console.log('Running ping -c 4 8.8.8.8...\n');

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

          console.log(`Response #${responseCount}: ${responseTime}ms`);
        }
      }

      // Show final statistics
      if (output.includes('packets transmitted')) {
        console.log('\n📊 Final Statistics:');
        console.log(`• Total responses: ${responseCount}`);
        if (responses.length > 0) {
          console.log(
            `• Average time: ${(totalTime / responses.length).toFixed(2)}ms`
          );
          console.log(`• Min time: ${Math.min(...responses).toFixed(2)}ms`);
          console.log(`• Max time: ${Math.max(...responses).toFixed(2)}ms`);
        }
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
