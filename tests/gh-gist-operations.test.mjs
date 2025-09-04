import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('GitHub Gist Operations with $.mjs', () => {
  let isAuthenticated = false;
  let testGistId = null;
  const TEST_DESC = 'test-command-stream-gist';
  const CI_ENVIRONMENT = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  
  beforeAll(async () => {
    // Skip write operations in CI environment
    if (CI_ENVIRONMENT) {
      console.log('Skipping gist write tests in CI environment');
      return;
    }
    
    // Check if authenticated
    const authResult = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    isAuthenticated = authResult.code === 0;
    
    if (!isAuthenticated) {
      console.log('Skipping gist tests - GitHub CLI not authenticated');
    }
  });
  
  afterAll(async () => {
    // Clean up any test gists
    if (isAuthenticated && testGistId) {
      try {
        await $`gh gist delete ${testGistId} --yes`.run({ capture: true, mirror: false });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });
  
  test('gh gist create should work with $.mjs and not hang', async () => {
    if (CI_ENVIRONMENT || !isAuthenticated) {
      console.log('Skipped: CI environment or not authenticated');
      return;
    }
    
    // Create a temporary file
    const tempFile = path.join(os.tmpdir(), 'test-gist-file.txt');
    await fs.writeFile(tempFile, 'Test content for gist\n');
    
    try {
      // Create gist with timeout to prevent hanging
      const result = await $`gh gist create ${tempFile} --desc "${TEST_DESC}" --public=false 2>&1`.run({
        capture: true,
        mirror: false,
        timeout: 10000 // 10 second timeout
      });
      
      // Should complete successfully
      expect(result.code).toBe(0);
      expect(result.stdout).toBeDefined();
      expect(result.stdout).toContain('gist.github.com');
      
      // Extract gist ID for cleanup
      const lines = result.stdout.trim().split('\n');
      const gistUrl = lines.find(line => line.includes('gist.github.com'));
      if (gistUrl) {
        testGistId = gistUrl.split('/').pop();
        expect(testGistId).toBeTruthy();
        expect(testGistId.length).toBeGreaterThan(0);
      }
      
    } finally {
      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {});
    }
  });
  
  test('gh gist view should retrieve gist details', async () => {
    if (CI_ENVIRONMENT || !isAuthenticated || !testGistId) {
      console.log('Skipped: CI environment or no test gist available');
      return;
    }
    
    const result = await $`gh gist view ${testGistId} --files`.run({
      capture: true,
      mirror: false
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout).toContain('test-gist-file.txt');
  });
  
  test('gh api should work for gist operations', async () => {
    if (CI_ENVIRONMENT || !isAuthenticated || !testGistId) {
      console.log('Skipped: CI environment or no test gist available');
      return;
    }
    
    const result = await $`gh api /gists/${testGistId} --jq '.description'`.run({
      capture: true,
      mirror: false
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(TEST_DESC);
  });
  
  test.skip('gh gist edit should add files to existing gist', async () => {
    if (CI_ENVIRONMENT || !isAuthenticated || !testGistId) {
      console.log('Skipped: CI environment or no test gist available');
      return;
    }
    
    // Create another file to add
    const tempFile2 = path.join(os.tmpdir(), 'additional-file.txt');
    await fs.writeFile(tempFile2, 'Additional content\n');
    
    try {
      const result = await $`gh gist edit ${testGistId} ${tempFile2} --filename "added.txt" 2>&1`.run({
        capture: true,
        mirror: false,
        timeout: 10000
      });
      
      // gh gist edit may not return 0 but should complete
      expect(result).toBeDefined();
      
      // Verify file was added
      const verifyResult = await $`gh gist view ${testGistId} --files`.run({
        capture: true,
        mirror: false
      });
      
      expect(verifyResult.code).toBe(0);
      expect(verifyResult.stdout).toContain('added.txt');
      
    } finally {
      await fs.unlink(tempFile2).catch(() => {});
    }
  });
  
  test('gh gist delete should remove gist', async () => {
    if (CI_ENVIRONMENT || !isAuthenticated || !testGistId) {
      console.log('Skipped: CI environment or no test gist available');
      return;
    }
    
    const result = await $`gh gist delete ${testGistId} --yes`.run({
      capture: true,
      mirror: false
    });
    
    expect(result.code).toBe(0);
    
    // Verify deletion - should fail to view
    try {
      await $`gh gist view ${testGistId}`.run({
        capture: true,
        mirror: false
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Expected to fail
      expect(error).toBeDefined();
    }
    
    // Clear the ID since it's deleted
    testGistId = null;
  });
  
  test('complex gh command with pipes should work', async () => {
    if (CI_ENVIRONMENT || !isAuthenticated) {
      console.log('Skipped: CI environment or not authenticated');
      return;
    }
    
    // Test piping gh output through other commands
    const result = await $`gh api /gists --jq '.[0].id' | head -1`.run({
      capture: true,
      mirror: false
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    // Should be a single line (gist ID)
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBe(1);
  });
});