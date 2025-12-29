#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

enableVirtualCommands();
shell.verbose(true);

console.log('=== Correct handling of paths with spaces ===\n');

const baseDir = mkdtempSync(join(tmpdir(), 'space-test-'));
const dirWithSpaces = join(baseDir, 'my test directory');
mkdirSync(dirWithSpaces);
const originalCwd = process.cwd();

console.log('Directory created:', dirWithSpaces);

try {
  console.log('\nCorrect way: Let $ handle the quoting');
  // This is the correct way - let the template literal handle quoting
  const result1 = await $`cd ${dirWithSpaces}`;
  console.log('Exit code:', result1.code);

  const pwd1 = await $`pwd`;
  console.log('Current dir:', pwd1.stdout.trim());
  console.log('Expected:', dirWithSpaces);
  console.log('Match:', pwd1.stdout.trim() === dirWithSpaces);

  await $`cd ${originalCwd}`;

  console.log('\nAlso works: cd with && chain');
  const result2 = await $`cd ${dirWithSpaces} && pwd`;
  console.log('Output:', result2.stdout.trim());
  console.log('Expected:', dirWithSpaces);
  console.log('Match:', result2.stdout.trim() === dirWithSpaces);
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
} finally {
  process.chdir(originalCwd);
  rmSync(baseDir, { recursive: true, force: true });
}

console.log('\n=== Test Complete ===');
