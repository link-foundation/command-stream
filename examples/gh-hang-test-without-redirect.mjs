#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';

console.log('Testing gh gist create WITHOUT 2>&1 (potential hang)');
console.log('This test will timeout after 10 seconds if it hangs\n');

const testFile = '/tmp/hang-test-no-redirect.txt';
await fs.writeFile(testFile, 'Test content\n');

try {
  const startTime = Date.now();
  
  // WITHOUT 2>&1 - might hang
  const result = await $`gh gist create ${testFile} --desc "test-hang" --public=false`.run({
    capture: true,
    mirror: false,
    timeout: 10000
  });
  
  const duration = Date.now() - startTime;
  console.log(`✅ SUCCESS - Completed in ${duration}ms`);
  console.log('Exit code:', result.code);
  console.log('Stdout:', result.stdout?.trim());
  console.log('Stderr:', result.stderr?.trim());
  
  // Cleanup
  if (result.stdout?.includes('gist.github.com')) {
    const gistId = result.stdout.trim().split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({ capture: true, mirror: false });
  }
  
} catch (error) {
  console.log('❌ FAILED or TIMED OUT');
  console.log('Error:', error.message);
  console.log('This confirms the hanging issue!');
}

await fs.unlink(testFile).catch(() => {});