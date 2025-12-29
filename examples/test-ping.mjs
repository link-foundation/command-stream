#!/usr/bin/env node

// Test ping example similar to hive-mind/claude-pipe/test-ping.mjs
import { $ } from '../js/src/$.mjs';

console.log('STARTING_PING');
try {
  await $`ping 8.8.8.8`;
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
