#!/usr/bin/env bun
// Debug the exit command specifically

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testExitCommand() {
  console.log('=== Exit Command Debug ===');

  console.log('\n1. Testing exit 1 in isolation...');
  try {
    const result = await $`exit 1`;
    console.log('Exit 1 succeeded (unexpected):', result);
  } catch (e) {
    console.log('Exit 1 failed (expected):');
    console.log('- Message:', e.message);
    console.log('- Code:', e.code);
    console.log('- Type:', typeof e);
    console.log('- Constructor:', e.constructor.name);
    console.log('- Keys:', Object.keys(e));
    console.log('- Full error:', e);
  }

  console.log('\n2. Testing echo then exit 1...');
  try {
    const result = await $`echo "test"; exit 1`;
    console.log('Echo + exit 1 succeeded (unexpected):', result);
  } catch (e) {
    console.log('Echo + exit 1 failed (expected):');
    console.log('- Message:', e.message);
    console.log('- Code:', e.code);
    console.log('- Full error:', e);
  }
}

testExitCommand().catch(console.error);
