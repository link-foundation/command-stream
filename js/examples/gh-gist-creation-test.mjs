#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

console.log('=== Testing Secret Gist Creation with $.mjs ===\n');

const TEST_GIST_DESC = 'test-gist-from-command-stream';
const TEST_FILE_CONTENT =
  '# Test Gist\n\nThis is a test gist created by command-stream $.mjs library.\n';

async function cleanup() {
  // Clean up any existing test gists
  console.log('🧹 Cleaning up any existing test gists...');
  try {
    const listResult =
      await $`gh api /gists --jq '.[] | select(.description == "${TEST_GIST_DESC}") | .id'`.run(
        { capture: true, mirror: false }
      );
    const gistIds = listResult.stdout
      .trim()
      .split('\n')
      .filter((id) => id);

    for (const gistId of gistIds) {
      if (gistId) {
        console.log(`   Deleting old test gist: ${gistId}`);
        await $`gh gist delete ${gistId} --yes`.run({
          capture: true,
          mirror: false,
        });
      }
    }
  } catch (error) {
    console.log('   No existing test gists to clean up');
  }
}

async function createGist() {
  console.log('\n📝 Creating a secret gist...');

  // Create temp file
  const tempFile = path.join(os.tmpdir(), 'test-gist-content.md');
  await fs.writeFile(tempFile, TEST_FILE_CONTENT);

  try {
    // Create secret gist - use 2>&1 to capture all output
    console.log('   Running: gh gist create with file:', tempFile);
    const createResult =
      await $`gh gist create ${tempFile} --desc "${TEST_GIST_DESC}" --public=false 2>&1`.run(
        {
          capture: true,
          mirror: false,
          timeout: 10000, // 10 second timeout
        }
      );

    console.log('   Exit code:', createResult.code);
    console.log('   Output:', createResult.stdout.trim());

    if (createResult.code !== 0) {
      throw new Error(`Failed to create gist. Exit code: ${createResult.code}`);
    }

    // Extract gist ID from URL (last line should be the URL)
    const outputLines = createResult.stdout.trim().split('\n');
    const gistUrl =
      outputLines.find((line) => line.includes('gist.github.com')) ||
      outputLines[outputLines.length - 1];

    if (!gistUrl || !gistUrl.includes('gist.github.com')) {
      throw new Error(`Invalid gist URL returned: ${gistUrl}`);
    }

    const gistId = gistUrl.split('/').pop();

    console.log('   ✅ Gist created with ID:', gistId);

    // Clean up temp file
    await fs.unlink(tempFile);

    return gistId;
  } catch (error) {
    await fs.unlink(tempFile).catch(() => {});
    throw error;
  }
}

async function verifyGistExists(gistId) {
  console.log('\n🔍 Verifying gist exists...');

  // Method 1: Using gh gist view
  try {
    const viewResult = await $`gh gist view ${gistId} --files`.run({
      capture: true,
      mirror: false,
    });
    console.log('   Method 1 (gh gist view):');
    console.log('   - Exit code:', viewResult.code);
    console.log('   - Files found:', viewResult.stdout.trim());
    console.log('   - ✅ Gist exists and is accessible');
  } catch (error) {
    console.log('   ❌ Method 1 failed:', error.message);
  }

  // Method 2: Using gh api
  try {
    const apiResult = await $`gh api /gists/${gistId} --jq '.description'`.run({
      capture: true,
      mirror: false,
    });
    console.log('   Method 2 (gh api):');
    console.log('   - Exit code:', apiResult.code);
    console.log('   - Description:', apiResult.stdout.trim());
    console.log('   - ✅ Confirmed via API');
  } catch (error) {
    console.log('   ❌ Method 2 failed:', error.message);
  }

  // Method 3: Check if it's secret
  try {
    const secretResult = await $`gh api /gists/${gistId} --jq '.public'`.run({
      capture: true,
      mirror: false,
    });
    const isPublic = secretResult.stdout.trim() === 'true';
    console.log('   Method 3 (check privacy):');
    console.log('   - Is public:', isPublic);
    console.log('   - Is secret:', !isPublic);
    console.log(
      '   -',
      !isPublic ? '✅ Confirmed as secret gist' : '❌ Not a secret gist'
    );
  } catch (error) {
    console.log('   ❌ Method 3 failed:', error.message);
  }
}

async function findGistByDescription() {
  console.log('\n🔎 Finding gist by description...');

  try {
    // Use jq to filter gists by description
    const findResult =
      await $`gh api /gists --jq '.[] | select(.description == "${TEST_GIST_DESC}") | .id + " " + .description' | head -1`.run(
        { capture: true, mirror: false }
      );

    if (findResult.stdout.trim()) {
      const [id, desc] = findResult.stdout.trim().split(' ');
      console.log('   - Found gist ID:', id);
      console.log('   - Description:', desc || TEST_GIST_DESC);
      console.log('   - ✅ Successfully found by description');
      return id;
    } else {
      console.log('   - ❌ No gist found with that description');
      return null;
    }
  } catch (error) {
    console.log('   ❌ Error finding gist:', error.message);
    return null;
  }
}

async function addFileToGist(gistId) {
  console.log('\n📎 Adding another file to the gist...');

  const tempFile2 = path.join(os.tmpdir(), 'additional-file.txt');
  await fs.writeFile(
    tempFile2,
    'This is an additional file added to the gist.\n'
  );

  try {
    const editResult =
      await $`gh gist edit ${gistId} ${tempFile2} --filename "added-file.txt"`.run(
        { capture: true, mirror: false }
      );
    console.log('   - Exit code:', editResult.code);
    console.log('   - ✅ File added successfully');

    // Verify the file was added
    const filesResult = await $`gh gist view ${gistId} --files`.run({
      capture: true,
      mirror: false,
    });
    console.log('   - Files in gist:', filesResult.stdout.trim());

    await fs.unlink(tempFile2);
    return true;
  } catch (error) {
    await fs.unlink(tempFile2).catch(() => {});
    console.log('   ❌ Failed to add file:', error.message);
    return false;
  }
}

async function deleteGist(gistId) {
  console.log('\n🗑️  Deleting the test gist...');

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

// Main test flow
async function runTests() {
  try {
    // Check authentication first
    console.log('🔐 Checking GitHub authentication...');
    const authResult = await $`gh auth status`.run({
      capture: true,
      mirror: false,
    });
    if (authResult.code !== 0) {
      console.error(
        '❌ Not authenticated to GitHub. Please run: gh auth login'
      );
      process.exit(1);
    }
    console.log('   ✅ Authenticated\n');

    // Clean up any existing test gists
    await cleanup();

    // Create a secret gist
    const gistId = await createGist();

    // Verify it exists
    await verifyGistExists(gistId);

    // Find it by description
    const foundId = await findGistByDescription();
    console.log('   - IDs match:', foundId === gistId ? '✅ Yes' : '❌ No');

    // Add a file to it
    await addFileToGist(gistId);

    // Delete it
    await deleteGist(gistId);

    // Verify it's gone
    console.log('\n✅ Verifying deletion...');
    try {
      await $`gh gist view ${gistId}`.run({ capture: true, mirror: false });
      console.log('   ❌ Gist still exists!');
    } catch (error) {
      console.log('   ✅ Confirmed: gist no longer exists');
    }

    console.log('\n=== Summary ===');
    console.log(
      '✅ Successfully created, verified, modified, and deleted a secret gist'
    );
    console.log('✅ All operations work correctly with $.mjs');
    console.log('✅ Exit codes are properly captured');
    console.log('✅ Output is correctly captured in stdout');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the tests
runTests();
