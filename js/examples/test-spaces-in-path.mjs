#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

enableVirtualCommands();
shell.verbose(true);

console.log('=== Testing paths with spaces ===\n');

const baseDir = mkdtempSync(join(tmpdir(), 'space-test-'));
const dirWithSpaces = join(baseDir, 'my test directory');
mkdirSync(dirWithSpaces);
const originalCwd = process.cwd();

console.log('Directory created:', dirWithSpaces);

try {
  console.log('\nTest 1: cd with quoted path');
  const result1 = await $`cd "${dirWithSpaces}" && pwd`;
  console.log('Exit code:', result1.code);
  console.log('Directory during invocation:', result1.stdout.trim());
  console.log('Stderr:', result1.stderr);
  console.log('Expected:', dirWithSpaces);
  console.log('Match:', result1.stdout.trim() === dirWithSpaces);
  console.log('Host cwd unchanged:', process.cwd() === originalCwd);

  console.log('\nTest 2: pre-escaped interpolated paths are not supported');
  const escaped = dirWithSpaces.replace(/ /g, '\\ ');
  const result2 = await $`cd ${escaped} && pwd`;
  console.log('Exit code:', result2.code);
  console.log('Expected non-zero result:', result2.code !== 0);
} catch (error) {
  console.error('Error:', error.message);
} finally {
  process.chdir(originalCwd);
  rmSync(baseDir, { recursive: true, force: true });
}

console.log('\n=== Test Complete ===');
