#!/usr/bin/env node

// Event-based with custom stdin

import { $ } from '../src/$.mjs';

console.log('Event-based with custom stdin:');
const $withInput = $({ stdin: 'Hello\nWorld\nTest\n', mirror: false });

try {
  const runner = $withInput`cat -n`;
  
  let lineCount = 0;
  
  runner.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      lineCount++;
      console.log(`📝 Line processed: ${line}`);
    }
  });
  
  runner.on('close', (code) => {
    console.log(`✅ Input processing completed`);
    console.log(`📊 Total lines processed: ${lineCount}`);
  });
  
  await runner;
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}