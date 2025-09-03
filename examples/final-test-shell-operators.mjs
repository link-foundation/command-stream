#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

enableVirtualCommands();
shell.verbose(false);

console.log('=== Final Shell Operators Test ===\n');

const testResults = [];

async function test(name, fn) {
  try {
    await fn();
    testResults.push({ name, status: '✓' });
    console.log(`✓ ${name}`);
  } catch (error) {
    testResults.push({ name, status: '✗', error: error.message });
    console.log(`✗ ${name}: ${error.message}`);
  }
}

const originalCwd = process.cwd();

// Test 1: && operator
await test('&& operator works', async () => {
  const result = await $`cd /tmp && pwd`;
  if (result.stdout.trim() !== '/tmp') {
    throw new Error(`Expected /tmp, got ${result.stdout.trim()}`);
  }
  process.chdir(originalCwd);
});

// Test 2: || operator
await test('|| operator works', async () => {
  const result = await $`cd /nonexistent 2>/dev/null || echo "failed"`;
  if (!result.stdout.includes('failed')) {
    throw new Error('Expected "failed" in output');
  }
});

// Test 3: ; operator
await test('; operator works', async () => {
  const result = await $`cd /tmp ; pwd ; cd /usr ; pwd`;
  const lines = result.stdout.trim().split('\n');
  if (lines[0] !== '/tmp' || lines[1] !== '/usr') {
    throw new Error(`Expected /tmp and /usr, got ${lines.join(', ')}`);
  }
  process.chdir(originalCwd);
});

// Test 4: Subshell ()
await test('Subshell isolation works', async () => {
  await $`cd /tmp`;
  const result = await $`(cd /usr && pwd) ; pwd`;
  const lines = result.stdout.trim().split('\n');
  if (lines[0] !== '/usr' || lines[1] !== '/tmp') {
    throw new Error(`Expected /usr then /tmp, got ${lines.join(', ')}`);
  }
  process.chdir(originalCwd);
});

// Test 5: Complex chain
await test('Complex chain works', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    const result = await $`cd ${tempDir} && echo "file1" > a.txt && echo "file2" > b.txt && ls | wc -l`;
    const fileCount = parseInt(result.stdout.trim());
    if (fileCount !== 2) {
      throw new Error(`Expected 2 files, got ${fileCount}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    process.chdir(originalCwd);
  }
});

// Test 6: cd persists across commands
await test('cd persists in session', async () => {
  await $`cd /var`;
  const pwd = await $`pwd`;
  if (pwd.stdout.trim() !== '/var') {
    throw new Error(`Expected /var, got ${pwd.stdout.trim()}`);
  }
  process.chdir(originalCwd);
});

// Test 7: Nested subshells
await test('Nested subshells work', async () => {
  const result = await $`(cd /tmp && (cd /usr && pwd) && pwd)`;
  const lines = result.stdout.trim().split('\n');
  if (lines[0] !== '/usr' || lines[1] !== '/tmp') {
    throw new Error(`Expected /usr then /tmp, got ${lines.join(', ')}`);
  }
});

// Test 8: Virtual commands in chains
await test('Virtual commands work in chains', async () => {
  const result = await $`echo "hello" && pwd && echo "world"`;
  if (!result.stdout.includes('hello') || !result.stdout.includes('world')) {
    throw new Error('Expected both hello and world in output');
  }
});

// Summary
console.log('\n=== Test Summary ===');
const passed = testResults.filter(r => r.status === '✓').length;
const failed = testResults.filter(r => r.status === '✗').length;
console.log(`Passed: ${passed}/${testResults.length}`);
if (failed > 0) {
  console.log('\nFailed tests:');
  testResults.filter(r => r.status === '✗').forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
}

process.exit(failed > 0 ? 1 : 0);