#!/usr/bin/env node
// Test script to verify SIGINT handler cleanup
// This runs in a subprocess to avoid interfering with the test runner

import { $ } from '../src/$.mjs';

process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('TEST: Starting SIGINT handler test');

// Test 1: Verify handler is installed when command starts
console.log('TEST: Check initial state');
const initialListeners = process.listeners('SIGINT').length;
console.log(`RESULT: initial_listeners=${initialListeners}`);

// Start a command
console.log('TEST: Starting command');
const runner = $`sleep 0.1`;
const promise = runner.start();

// Check handler was installed
const duringListeners = process.listeners('SIGINT').length;
console.log(`RESULT: during_listeners=${duringListeners}`);

// Wait for completion
await promise;

// Check handler was removed
const afterListeners = process.listeners('SIGINT').length;
console.log(`RESULT: after_listeners=${afterListeners}`);

// Test 2: Multiple concurrent commands share single handler
console.log('TEST: Starting multiple concurrent commands');
const promises = [$`sleep 0.05`, $`sleep 0.05`, $`sleep 0.05`];

const starts = promises.map((p) => p.start());
const concurrentListeners = process.listeners('SIGINT').length;
console.log(`RESULT: concurrent_listeners=${concurrentListeners}`);

await Promise.all(starts);
const afterConcurrentListeners = process.listeners('SIGINT').length;
console.log(`RESULT: after_concurrent_listeners=${afterConcurrentListeners}`);

// Test 3: Handler removed on error
console.log('TEST: Testing error handling');
try {
  await $`exit 1`;
} catch (e) {
  // Expected
}

const afterErrorListeners = process.listeners('SIGINT').length;
console.log(`RESULT: after_error_listeners=${afterErrorListeners}`);

// Test 4: Handler removed when command is killed
console.log('TEST: Testing kill cleanup');
const killRunner = $`sleep 10`;
const killPromise = killRunner.start();

setTimeout(() => killRunner.kill(), 10);

try {
  await killPromise;
} catch (e) {
  // Expected
}

const afterKillListeners = process.listeners('SIGINT').length;
console.log(`RESULT: after_kill_listeners=${afterKillListeners}`);

console.log('TEST: Complete');
process.exit(0);
