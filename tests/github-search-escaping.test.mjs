import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $ } from '../src/$.mjs';

describe('GitHub search escaping (Issue #48)', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
  });
  
  afterEach(async () => {
    await afterTestCleanup();
  });

  test('quote function should prefer double quotes for simple spaced strings', async () => {
    const { quote } = await import('../src/$.mjs');
    
    // Test the improved quote function
    expect(quote('help wanted')).toBe('"help wanted"');
    expect(quote('simple text')).toBe('"simple text"');
    expect(quote('nospaces')).toBe('nospaces'); // No quoting needed
    expect(quote('no-spaces')).toBe('no-spaces'); // Safe characters, no quoting needed
    expect(quote('no spaces')).toBe('"no spaces"'); // Spaces need quoting, prefer double quotes
    expect(quote('has"double')).toBe("'has\"double'"); // Use single quotes when has double quotes
    expect(quote("has'single")).toBe("'has'\\''single'"); // Use traditional escaping for strings with single quotes
  });

  test('GitHub CLI search without quotes should work', async () => {
    // Skip if not authenticated
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping GitHub search test - not authenticated');
      return;
    }

    const owner = 'nodejs';
    const repo = 'node';
    
    // This should work - no quotes around search query
    const result = await $`gh search issues repo:${owner}/${repo} is:open --limit 1 --json url,title`.run({ 
      capture: true, 
      mirror: false 
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    
    // Should be valid JSON
    const issues = JSON.parse(result.stdout);
    expect(Array.isArray(issues)).toBe(true);
  });

  test('GitHub CLI search with label (using + for spaces) should work', async () => {
    // Skip if not authenticated  
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping GitHub search test - not authenticated');
      return;
    }

    const owner = 'nodejs';
    const repo = 'node';
    const label = 'help wanted';
    const encodedLabel = label.replace(/\s+/g, '+');
    
    // This should work - spaces replaced with +
    const result = await $`gh search issues repo:${owner}/${repo} is:open label:${encodedLabel} --limit 1 --json url,title`.run({ 
      capture: true, 
      mirror: false 
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    
    // Should be valid JSON (even if empty array)
    const issues = JSON.parse(result.stdout);
    expect(Array.isArray(issues)).toBe(true);
  });

  test('template literals with spaces should not break shell parsing', async () => {
    const testString = 'hello world';
    
    // Test that our improved quoting works in template literals
    const result = await $`echo prefix:${testString}`.run({ capture: true, mirror: false });
    
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('prefix:"hello world"');
  });

  test('complex GitHub search query components should work separately', async () => {
    // Skip if not authenticated
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping GitHub search test - not authenticated');
      return;
    }

    const owner = 'microsoft';
    const repo = 'vscode';
    const repoQuery = `repo:${owner}/${repo}`;
    const statusQuery = 'is:open';
    const typeQuery = 'is:issue';
    
    // Build query with separate components (no quotes around overall query)
    const result = await $`gh search issues ${repoQuery} ${statusQuery} ${typeQuery} --limit 1 --json url,title`.run({ 
      capture: true, 
      mirror: false 
    });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    
    // Should be valid JSON
    const issues = JSON.parse(result.stdout);
    expect(Array.isArray(issues)).toBe(true);
  });

  test('echo with nested quotes should handle improved quoting', async () => {
    const labelWithSpaces = 'help wanted';
    
    // Test how the improved quote function handles nested contexts
    const result = await $`echo label:${labelWithSpaces}`.run({ capture: true, mirror: false });
    
    expect(result.code).toBe(0);
    // With improved quoting, this should produce: label:"help wanted"  
    expect(result.stdout.trim()).toBe('label:"help wanted"');
  });
});