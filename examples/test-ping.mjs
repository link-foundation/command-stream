#!/usr/bin/env node

// Test ping example similar to hive-mind/claude-pipe/test-ping.mjs
import { $ } from '../src/$.mjs';

try {
  await $`ping 8.8.8.8`;
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}