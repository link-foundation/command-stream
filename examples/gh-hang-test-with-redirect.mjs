#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';

console.log('Testing gh gist create WITH 2>&1 (should work)');
console.log('This test will timeout after 10 seconds if it hangs\n');

const testFile = '/tmp/hang-test-with-redirect.txt';
await fs.writeFile(testFile, 'Test content\n');

try {
  const startTime = Date.now();
  
  // WITH 2>&1 - should work
  const result = await $`gh gist create ${testFile} --desc "test-no-hang" --public=false 2>&1`.run({
    capture: true,
    mirror: false,
    timeout: 10000
  });
  
  const duration = Date.now() - startTime;
  console.log(`✅ SUCCESS - Completed in ${duration}ms`);
  console.log('Exit code:', result.code);
  console.log('Output:', result.stdout?.trim());
  
  // Cleanup
  const lines = result.stdout?.trim().split('\n') || [];
  const gistUrl = lines.find(line => line.includes('gist.github.com'));
  if (gistUrl) {
    const gistId = gistUrl.split('/').pop();
    await $`gh gist delete ${gistId} --yes`.run({ capture: true, mirror: false });
  }
  
} catch (error) {
  console.log('❌ FAILED');
  console.log('Error:', error.message);
}

await fs.unlink(testFile).catch(() => {});