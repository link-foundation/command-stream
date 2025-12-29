#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';
import fs from 'fs/promises';

console.log('=== Minimal gh gist create test ===\n');

// Create a test file
const testFile = '/tmp/test-minimal.txt';
await fs.writeFile(testFile, 'Test content from minimal test\n');

console.log('Test 1: Direct command execution');
try {
  console.log('Running: gh gist create with timeout...');
  const result =
    await $`timeout 10 gh gist create ${testFile} --desc "minimal-test" --public=false`.run(
      {
        capture: true,
        mirror: true, // Show output as it happens
      }
    );

  console.log('\nResult:');
  console.log('- Exit code:', result.code);
  console.log('- Stdout:', result.stdout?.slice(0, 100));

  // Extract gist ID and delete it
  const gistUrl = result.stdout?.trim();
  if (gistUrl && gistUrl.includes('gist.github.com')) {
    const gistId = gistUrl.split('/').pop();
    console.log('- Gist ID:', gistId);

    // Clean up
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('- Cleaned up test gist');
  }
} catch (error) {
  console.log('Error:', error.message);
  console.log('Exit code:', error.code);
}

console.log('\n---\n');

console.log('Test 2: Without timeout wrapper');
try {
  console.log('Running: gh gist create directly...');

  // Set a timeout option if available
  const result =
    await $`gh gist create ${testFile} --desc "minimal-test-2" --public=false`.run(
      {
        capture: true,
        mirror: true,
        timeout: 10000, // 10 second timeout
      }
    );

  console.log('\nResult:');
  console.log('- Exit code:', result.code);
  console.log('- Stdout:', result.stdout?.slice(0, 100));

  // Extract gist ID and delete it
  const gistUrl = result.stdout?.trim();
  if (gistUrl && gistUrl.includes('gist.github.com')) {
    const gistId = gistUrl.split('/').pop();
    console.log('- Gist ID:', gistId);

    // Clean up
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('- Cleaned up test gist');
  }
} catch (error) {
  console.log('Error:', error.message);
  console.log('Exit code:', error.code);
  if (error.killed) {
    console.log('Process was killed (timeout?)');
  }
}

// Clean up test file
await fs.unlink(testFile).catch(() => {});

console.log('\n=== Done ===');
