#!/usr/bin/env node

// Basic event-based ping with options

import { $ } from '../src/$.mjs';

console.log('Basic event-based ping (silent mode):');
const $silent = $({ mirror: false });

try {
  const runner = $silent`ping -c 5 8.8.8.8`;
  
  let packetCount = 0;
  
  runner.on('stdout', (data) => {
    const output = data.toString().trim();
    if (output.includes('bytes from')) {
      packetCount++;
      const timeMatch = output.match(/time=([0-9.]+)/);
      const responseTime = timeMatch ? timeMatch[1] : 'unknown';
      console.log(`📡 Packet #${packetCount}: ${responseTime}ms`);
    }
  });
  
  runner.on('stderr', (data) => {
    console.log(`⚠️  Error: ${data.toString().trim()}`);
  });
  
  runner.on('close', (code) => {
    console.log(`✅ Ping completed with exit code: ${code}`);
    console.log(`📊 Total packets received: ${packetCount}`);
  });
  
  await runner;
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}