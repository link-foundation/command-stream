#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

console.log('=== Attempting to reproduce the hanging issue ===\n');
console.log('Using invalid --secret flag without timeout or error handling');
console.log('This should demonstrate the hanging behavior\n');

const tempFile = path.join(os.tmpdir(), 'hang-reproduce.md');
await fs.writeFile(tempFile, '# Test Gist\nTrying to reproduce hanging\n');

console.log('Starting command that should hang...');
console.log('If this hangs, press Ctrl+C to stop\n');

// This is the problematic combination:
// 1. Invalid --secret flag
// 2. No timeout
// 3. No 2>&1 redirect
// 4. capture: true, mirror: false
// 5. No error handling to catch the exit code

const startTime = Date.now();

const result =
  await $`gh gist create ${tempFile} --desc "hang-test" --secret`.run({
    capture: true,
    mirror: false,
    // No timeout - let it hang if it will
  });

// If we get here, it didn't hang
const duration = Date.now() - startTime;
console.log(`\nCompleted in ${duration}ms (did not hang)`);
console.log('Exit code:', result.code);
console.log('Stdout:', result.stdout);
console.log('Stderr:', result.stderr);

await fs.unlink(tempFile).catch(() => {});
