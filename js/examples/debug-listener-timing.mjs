#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Listener Timing Debug ===');

async function testEarlyListeners() {
  console.log('\n1. Attaching listeners BEFORE await:');
  const cmd = $`echo "test1"`;

  // Attach listeners immediately after creating command
  const events = [];
  cmd.on('data', () => events.push('data'));
  cmd.on('end', () => events.push('end'));
  cmd.on('exit', () => events.push('exit'));

  console.log('Events before await:', events);
  await cmd;
  console.log('Events after await:', events);
}

async function testLateListeners() {
  console.log('\n2. Attaching listeners AFTER await:');
  const cmd = $`echo "test2"`;

  // First await the command
  await cmd;

  // THEN attach listeners (too late!)
  const events = [];
  cmd.on('data', () => events.push('data'));
  cmd.on('end', () => events.push('end'));
  cmd.on('exit', () => events.push('exit'));

  console.log('Events after await (should be empty):', events);
}

async function testStreamWithEarlyListeners() {
  console.log('\n3. Testing stream with early listeners:');
  const cmd = $`echo "test3"`;

  const events = [];
  cmd.on('data', () => events.push('data'));
  cmd.on('end', () => events.push('end'));
  cmd.on('exit', () => events.push('exit'));

  console.log('Events before stream:', events);

  // Use stream instead of await
  for await (const chunk of cmd.stream()) {
    console.log('Stream chunk received');
    break; // Just get first chunk
  }

  console.log('Events after stream:', events);
}

await testEarlyListeners();
await testLateListeners();
await testStreamWithEarlyListeners();

console.log('\nDebug completed!');
