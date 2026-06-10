#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

console.log('=== Testing gh gist delete hanging scenario ===\n');

// First create a gist to delete
const tempFile = path.join(os.tmpdir(), 'delete-hang-test.txt');
await fs.writeFile(tempFile, 'Test content for deletion\n');

console.log('Creating a gist to test deletion...');
const createResult =
  await $`gh gist create ${tempFile} --desc "delete-test" --public=false 2>&1`.run(
    {
      capture: true,
      mirror: false,
    }
  );

const lines = createResult.stdout.trim().split('\n');
const gistUrl = lines.find((line) => line.includes('gist.github.com'));
if (!gistUrl) {
  console.error('Failed to create test gist');
  process.exit(1);
}

const gistId = gistUrl.split('/').pop();
console.log('Created gist:', gistId);

console.log('\nNow testing deletion that might hang...');
console.log('Using the pattern from the original test:\n');

// This is the pattern that was in the original test
async function deleteGist(gistId) {
  console.log('🗑️  Deleting the test gist...');

  try {
    const deleteResult = await $`gh gist delete ${gistId} --yes`.run({
      capture: true,
      mirror: false,
    });
    console.log('   - Exit code:', deleteResult.code);
    console.log('   - ✅ Gist deleted successfully');
    return true;
  } catch (error) {
    console.log('   ❌ Failed to delete:', error.message);
    return false;
  }
}

// Call the delete function
const startTime = Date.now();
await deleteGist(gistId);
const deleteTime = Date.now() - startTime;
console.log(`Delete completed in ${deleteTime}ms`);

// Now try to verify it's gone (this is where it might hang)
console.log('\n✅ Verifying deletion...');
const verifyStart = Date.now();

try {
  console.log('Running gh gist view (this might hang)...');
  await $`gh gist view ${gistId}`.run({ capture: true, mirror: false });
  console.log('   ❌ Gist still exists!');
} catch (error) {
  console.log('   ✅ Confirmed: gist no longer exists');
  console.log('   Error code:', error.code);
}

const verifyTime = Date.now() - verifyStart;
console.log(`Verification completed in ${verifyTime}ms`);

// Clean up
await fs.unlink(tempFile).catch(() => {});

console.log('\n=== Test completed without hanging ===');
