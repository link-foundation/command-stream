#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../js/src/$.mjs';
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
  const result1 = await $`cd "${dirWithSpaces}"`;
  console.log('Exit code:', result1.code);
  console.log('Stdout:', result1.stdout);
  console.log('Stderr:', result1.stderr);

  const pwd1 = await $`pwd`;
  console.log('Current dir:', pwd1.stdout.trim());
  console.log('Expected:', dirWithSpaces);
  console.log('Match:', pwd1.stdout.trim() === dirWithSpaces);

  await $`cd ${originalCwd}`;

  console.log('\nTest 2: cd with escaped spaces');
  const escaped = dirWithSpaces.replace(/ /g, '\\ ');
  const result2 = await $`cd ${escaped}`;
  console.log('Exit code:', result2.code);

  const pwd2 = await $`pwd`;
  console.log('Current dir:', pwd2.stdout.trim());
} catch (error) {
  console.error('Error:', error.message);
} finally {
  process.chdir(originalCwd);
  rmSync(baseDir, { recursive: true, force: true });
}

console.log('\n=== Test Complete ===');
