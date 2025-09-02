#!/usr/bin/env node

// Interruptible ping streaming - shows how to handle CTRL+C gracefully

import { $ } from '../src/$.mjs';

console.log('=== Interruptible Ping Streaming ===');
console.log('Streaming continuous ping - press CTRL+C to stop gracefully...\n');

let packetCount = 0;
let startTime = Date.now();

try {
  // Stream continuous ping (no -c limit)
  for await (const chunk of $`ping 8.8.8.8`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      
      if (output.includes('bytes from')) {
        packetCount++;
        const timeMatch = output.match(/time=([0-9.]+)/);
        const responseTime = timeMatch ? timeMatch[1] : 'unknown';
        
        console.log(`Packet #${packetCount}: ${responseTime}ms`);
        
        // Show periodic statistics
        if (packetCount % 5 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  └─ ${packetCount} packets in ${elapsed}s`);
        }
      }
    }
  }
} catch (error) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  if (error.code === 130 || error.code === -2) {
    console.log(`\n✅ Ping stopped by CTRL+C after ${elapsed}s`);
    console.log(`📊 Total packets received: ${packetCount}`);
    console.log('🎯 Stream handling completed gracefully!');
  } else {
    console.error(`\n❌ Ping failed: ${error.message}`);
    console.log(`📊 Packets received before failure: ${packetCount}`);
  }
}

console.log('\n=== Streaming session ended ===');