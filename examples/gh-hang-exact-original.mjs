#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

console.log('=== Testing EXACT original hanging scenario ===\n');
console.log('Using: --secret flag, no 2>&1, capture: true, mirror: false\n');

const tempFile = path.join(os.tmpdir(), 'original-hang-test.md');
await fs.writeFile(
  tempFile,
  '# Test\nThis tests the exact original scenario\n'
);

try {
  console.log('Running command that originally hung...');
  const startTime = Date.now();

  // EXACT original command that hung
  const result =
    await $`gh gist create ${tempFile} --desc "original-hang-test" --secret`.run(
      {
        capture: true,
        mirror: false,
        // No timeout in original
      }
    );

  const duration = Date.now() - startTime;

  console.log(`\n✅ Completed in ${duration}ms`);
  console.log('Exit code:', result.code);
  console.log('Stdout:', result.stdout?.trim());
  console.log('Stderr:', result.stderr?.trim());

  // Cleanup
  if (result.stdout?.includes('gist.github.com')) {
    const gistId = result.stdout.trim().split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('Cleaned up gist:', gistId);
  }
} catch (error) {
  console.log('\n❌ FAILED');
  console.log('Error:', error.message);
  console.log('This reproduces the original hanging issue!');
}

await fs.unlink(tempFile).catch(() => {});

console.log('\n=== Testing with variations ===\n');

// Test if --secret vs --public=false makes a difference
console.log('Test with --public=false instead of --secret:');
await fs.writeFile(tempFile, 'Test content\n');

try {
  const result =
    await $`gh gist create ${tempFile} --desc "public-false-test" --public=false`.run(
      {
        capture: true,
        mirror: false,
      }
    );

  console.log('✅ --public=false works');

  if (result.stdout?.includes('gist.github.com')) {
    const gistId = result.stdout.trim().split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
  }
} catch (error) {
  console.log('❌ --public=false also fails:', error.message);
}

await fs.unlink(tempFile).catch(() => {});
