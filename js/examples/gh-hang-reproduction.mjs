#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

console.log('=== Reproducing gh gist create hanging issue ===\n');

// Create test file
const testFile = path.join(os.tmpdir(), 'hang-test.txt');
await fs.writeFile(testFile, 'Test content\n');

console.log('Test 1: WITHOUT 2>&1 redirection (potential hang)');
console.log('Running gh gist create WITHOUT stderr redirection...');
console.log("(This might hang if there's an issue)\n");

try {
  const startTime = Date.now();

  // This was the problematic case
  const result =
    await $`gh gist create ${testFile} --desc "hang-test" --public=false`.run({
      capture: true,
      mirror: false, // Not mirroring - just capturing
      timeout: 5000, // 5 second safety timeout
    });

  const duration = Date.now() - startTime;

  console.log('✅ Completed in', duration, 'ms');
  console.log('Exit code:', result.code);
  console.log('Stdout length:', result.stdout?.length);
  console.log('Stderr length:', result.stderr?.length);
  console.log('Stdout content:', result.stdout?.trim());
  console.log('Stderr content:', result.stderr?.trim());

  // Clean up gist if created
  if (result.stdout && result.stdout.includes('gist.github.com')) {
    const gistId = result.stdout.trim().split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('Cleaned up gist:', gistId);
  }
} catch (error) {
  console.log('❌ Failed or timed out');
  console.log('Error:', error.message);
  if (error.killed) {
    console.log('Process was killed (likely timeout)');
  }
}

console.log('\n---\n');

console.log('Test 2: WITH 2>&1 redirection (should work)');
console.log('Running gh gist create WITH stderr redirection...\n');

try {
  const startTime = Date.now();

  // This is the workaround
  const result =
    await $`gh gist create ${testFile} --desc "hang-test-2" --public=false 2>&1`.run(
      {
        capture: true,
        mirror: false,
        timeout: 5000,
      }
    );

  const duration = Date.now() - startTime;

  console.log('✅ Completed in', duration, 'ms');
  console.log('Exit code:', result.code);
  console.log('Stdout length:', result.stdout?.length);
  console.log('Stderr length:', result.stderr?.length);
  console.log(
    'Stdout content (first 200 chars):',
    result.stdout?.slice(0, 200)
  );
  console.log('Stderr content:', result.stderr?.trim());

  // Extract URL from output
  const lines = result.stdout.trim().split('\n');
  const gistUrl = lines.find((line) => line.includes('gist.github.com'));

  if (gistUrl) {
    const gistId = gistUrl.split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('Cleaned up gist:', gistId);
  }
} catch (error) {
  console.log('❌ Failed');
  console.log('Error:', error.message);
}

console.log('\n---\n');

console.log('Test 3: WITH mirror: true (should also work)');
console.log('Running gh gist create WITH output mirroring...\n');

try {
  const startTime = Date.now();

  // Test with mirror enabled
  const result =
    await $`gh gist create ${testFile} --desc "hang-test-3" --public=false`.run(
      {
        capture: true,
        mirror: true, // This time we mirror output
        timeout: 5000,
      }
    );

  const duration = Date.now() - startTime;

  console.log('\n✅ Completed in', duration, 'ms');
  console.log('Exit code:', result.code);
  console.log('Stdout captured:', result.stdout?.trim());

  // Clean up
  if (result.stdout && result.stdout.includes('gist.github.com')) {
    const gistId = result.stdout.trim().split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('Cleaned up gist:', gistId);
  }
} catch (error) {
  console.log('❌ Failed');
  console.log('Error:', error.message);
}

// Clean up test file
await fs.unlink(testFile).catch(() => {});

console.log('\n=== Summary ===');
console.log('If Test 1 hangs/times out but Tests 2 and 3 work, then:');
console.log(
  '- Issue: gh outputs progress to stderr, and $.mjs might not handle it well'
);
console.log('- Workaround 1: Use 2>&1 to redirect stderr to stdout');
console.log(
  '- Workaround 2: Use mirror: true to display output while capturing'
);
