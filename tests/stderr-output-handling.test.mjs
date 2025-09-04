import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('Stderr output handling in $.mjs', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
  });
  
  afterEach(async () => {
    await afterTestCleanup();
  });
  
  test('commands that output to stderr should not hang when captured', async () => {
    // Test with a command that writes to stderr
    const result = await $`sh -c 'echo "stdout message" && echo "stderr message" >&2'`.run({
      capture: true,
      mirror: false,
      timeout: 5000 // Safety timeout
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('stdout message');
    expect(result.stderr).toContain('stderr message');
  });
  
  test('gh commands with progress output to stderr should complete', async () => {
    // Check if gh is available
    try {
      await $`which gh`.run({ capture: true, mirror: false });
    } catch {
      console.log('Skipping: gh not available');
      return;
    }
    
    // gh version outputs to stderr for progress
    const result = await $`gh version`.run({
      capture: true,
      mirror: false,
      timeout: 5000
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    // Version info should be in stdout
    expect(result.stdout).toContain('gh version');
  });
  
  test('capturing with 2>&1 should combine stderr into stdout', async () => {
    const result = await $`sh -c 'echo "stdout" && echo "stderr" >&2' 2>&1`.run({
      capture: true,
      mirror: false
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('stdout');
    expect(result.stdout).toContain('stderr');
    expect(result.stderr).toBe(''); // stderr should be empty since redirected
  });
  
  test('long-running commands with stderr output should not hang', async () => {
    // Create a script that outputs to both stdout and stderr over time
    const scriptPath = path.join(os.tmpdir(), 'test-script.sh');
    const scriptContent = `#!/bin/sh
for i in 1 2 3; do
  echo "stdout: iteration $i"
  echo "stderr: iteration $i" >&2
  sleep 0.1
done
`;
    await fs.writeFile(scriptPath, scriptContent);
    await $`chmod +x ${scriptPath}`.run({ capture: true, mirror: false });
    
    try {
      const startTime = Date.now();
      const result = await $`${scriptPath}`.run({
        capture: true,
        mirror: false,
        timeout: 5000
      });
      const duration = Date.now() - startTime;
      
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('stdout: iteration 3');
      expect(result.stderr).toContain('stderr: iteration 3');
      expect(duration).toBeLessThan(2000); // Should complete quickly, not hang
      
    } finally {
      await fs.unlink(scriptPath).catch(() => {});
    }
  });
  
  test('gh gist create with stderr progress should work correctly', async () => {
    // Check authentication first
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping gh gist test - not authenticated (this is OK - we are testing $.mjs, not gh auth)');
      return;
    }
    
    // Check if we can actually create gists (not just authenticated)
    const testAccess = await $`gh api user/gists --method HEAD 2>&1`.run({ capture: true, mirror: false });
    if (testAccess.code !== 0) {
      // In CI with GitHub Actions token, we might get 404 or 403 errors
      if (testAccess.stdout.includes('Resource not accessible by integration') || 
          testAccess.stdout.includes('HTTP 404') ||
          testAccess.stdout.includes('HTTP 403')) {
        console.log('Skipping gh gist test - limited GitHub Actions token or API access (this is OK - we are testing $.mjs, not gh permissions)');
        return;
      }
    }
    
    // Create test file
    const testFile = path.join(os.tmpdir(), 'stderr-test.txt');
    await fs.writeFile(testFile, 'Testing stderr handling\n');
    
    let gistId = null;
    
    try {
      // Without 2>&1 redirection - capture both streams separately
      const result1 = await $`gh gist create ${testFile} --desc "stderr-test-1" --public=false`.run({
        capture: true,
        mirror: false,
        timeout: 10000
      });
      
      expect(result1.code).toBe(0);
      expect(result1.stdout).toBeDefined();
      
      // The URL should be in stdout
      const url1 = result1.stdout.trim();
      expect(url1).toContain('gist.github.com');
      gistId = url1.split('/').pop();
      
      // Clean up first gist
      await $`gh gist delete ${gistId} --yes`.run({ capture: true, mirror: false });
      
      // With 2>&1 redirection - all output in stdout
      const result2 = await $`gh gist create ${testFile} --desc "stderr-test-2" --public=false 2>&1`.run({
        capture: true,
        mirror: false,
        timeout: 10000
      });
      
      expect(result2.code).toBe(0);
      expect(result2.stdout).toBeDefined();
      
      // Should contain both progress messages and URL
      expect(result2.stdout).toContain('Creating gist');
      expect(result2.stdout).toContain('gist.github.com');
      
      // Extract and clean up second gist
      const lines = result2.stdout.trim().split('\n');
      const url2 = lines.find(line => line.includes('gist.github.com'));
      if (url2) {
        gistId = url2.split('/').pop();
        await $`gh gist delete ${gistId} --yes`.run({ capture: true, mirror: false });
      }
      
    } finally {
      // Clean up
      await fs.unlink(testFile).catch(() => {});
      if (gistId) {
        await $`gh gist delete ${gistId} --yes`.run({ capture: true, mirror: false }).catch(() => {});
      }
    }
  });
  
  test('streaming mode should handle stderr correctly', async () => {
    const cmd = $`sh -c 'echo "line1" && echo "err1" >&2 && sleep 0.1 && echo "line2" && echo "err2" >&2'`;
    
    const collected = {
      stdout: [],
      stderr: []
    };
    
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout') {
        collected.stdout.push(chunk.data.toString());
      } else if (chunk.type === 'stderr') {
        collected.stderr.push(chunk.data.toString());
      }
    }
    
    const result = await cmd;
    
    expect(result.code).toBe(0);
    expect(collected.stdout.join('')).toContain('line1');
    expect(collected.stdout.join('')).toContain('line2');
    expect(collected.stderr.join('')).toContain('err1');
    expect(collected.stderr.join('')).toContain('err2');
  });
  
  test.skip('timeout should work even with pending stderr', async () => {
    // Command that continuously outputs to stderr
    const startTime = Date.now();
    
    try {
      await $`sh -c 'while true; do echo "stderr output" >&2; sleep 0.1; done'`.run({
        capture: true,
        mirror: false,
        timeout: 1000 // 1 second timeout
      });
      
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Should have timed out
      expect(duration).toBeGreaterThanOrEqual(900);
      expect(duration).toBeLessThan(1500);
      
      // Error should indicate timeout/killed
      expect(error).toBeDefined();
    }
  });
});