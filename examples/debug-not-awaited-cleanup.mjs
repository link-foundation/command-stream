#!/usr/bin/env bun
// Debug script to test the non-awaited command cleanup issue

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testNotAwaitedCleanup() {
  console.log('=== Not Awaited Cleanup Debug ===');
  
  console.log('\n1. Initial state:');
  const initialListeners = process.listeners('SIGINT').length;
  console.log('Initial SIGINT listeners:', initialListeners);
  
  console.log('\n2. Creating and starting commands without awaiting...');
  const runner1 = $`sleep 0.05`;
  const runner2 = $`echo "not awaited"`;
  const runner3 = $`pwd`;
  
  console.log('After creating runners, SIGINT listeners:', process.listeners('SIGINT').length);
  
  // Start them
  const promise1 = runner1.start();
  console.log('After starting runner1, SIGINT listeners:', process.listeners('SIGINT').length);
  
  const promise2 = runner2.start();
  console.log('After starting runner2, SIGINT listeners:', process.listeners('SIGINT').length);
  
  const promise3 = runner3.start();
  console.log('After starting runner3, SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n3. Checking after 50ms...');
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log('After 50ms, SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n4. Checking after 100ms total...');
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log('After 100ms total, SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n5. Checking after 200ms total...');
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('After 200ms total, SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n6. Checking individual promise statuses...');
  console.log('Promise 1 resolved?', await Promise.race([
    promise1.then(() => true),
    new Promise(r => setTimeout(() => r(false), 0))
  ]));
  console.log('Promise 2 resolved?', await Promise.race([
    promise2.then(() => true), 
    new Promise(r => setTimeout(() => r(false), 0))
  ]));
  console.log('Promise 3 resolved?', await Promise.race([
    promise3.then(() => true),
    new Promise(r => setTimeout(() => r(false), 0))
  ]));
  
  console.log('\n7. Forcing resolution by awaiting all...');
  try {
    const results = await Promise.all([promise1, promise2, promise3]);
    console.log('All promises resolved');
  } catch (e) {
    console.log('Error waiting for promises:', e.message);
  }
  
  console.log('\n8. Final state:');
  console.log('Final SIGINT listeners:', process.listeners('SIGINT').length);
  console.log('Expected:', initialListeners);
  console.log('Match?', process.listeners('SIGINT').length === initialListeners);
}

testNotAwaitedCleanup().catch(console.error);