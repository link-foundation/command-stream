#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Event Timing Debug ===');

// Enable verbose tracing to see what's happening inside
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testVirtualCommand() {
  console.log('\n1. Testing VIRTUAL echo command:');
  const cmd = $`echo "virtual test"`;
  
  const events = [];
  cmd.on('data', (chunk) => events.push(`data:${chunk.type}`));
  cmd.on('end', (result) => events.push(`end:${result.code}`));
  cmd.on('exit', (code) => events.push(`exit:${code}`));
  
  console.log('Events before await:', events);
  const result = await cmd;
  console.log('Events after await:', events);
  console.log('Result:', result.code, JSON.stringify(result.stdout?.trim() || ''));
  
  return events;
}

async function testRealCommand() {
  console.log('\n2. Testing REAL echo command:');
  disableVirtualCommands();
  const cmd = $`echo "real test"`;
  
  const events = [];
  cmd.on('data', (chunk) => events.push(`data:${chunk.type}`));
  cmd.on('end', (result) => events.push(`end:${result.code}`));
  cmd.on('exit', (code) => events.push(`exit:${code}`));
  
  console.log('Events before await:', events);
  const result = await cmd;
  console.log('Events after await:', events);  
  console.log('Result:', result.code, JSON.stringify(result.stdout?.trim() || ''));
  
  return events;
}

const virtualEvents = await testVirtualCommand();
const realEvents = await testRealCommand();

console.log('\n=== COMPARISON ===');
console.log('Virtual events:', virtualEvents);
console.log('Real events:', realEvents);

const match = JSON.stringify(virtualEvents) === JSON.stringify(realEvents);
console.log('Events match:', match);

if (!match) {
  console.log('❌ Virtual and real commands emit different events!');
} else {
  console.log('✅ Virtual and real commands emit same events!');
}
