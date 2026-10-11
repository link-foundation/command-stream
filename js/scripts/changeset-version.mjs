#!/usr/bin/env bun

/**
 * Custom changeset version script that ensures package-lock.json is synchronized
 * with package.json after version bumps.
 *
 * This script:
 * 1. Runs `changeset version` to update the JavaScript package version
 * 2. Runs `npm install` to synchronize package-lock.json with the new version
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 */

import { existsSync } from 'node:fs';
import { loadUseM } from './use-m-loader.mjs';
import { runChecked } from './run-checked.mjs';

// Load use-m dynamically, retrying a CDN blip instead of dying at module load.
const use = await loadUseM();

// Import command-stream for shell command execution
const { $ } = await use('command-stream');

try {
  console.log('Running changeset version...');
  await runChecked($`bunx changeset version`);

  if (existsSync('package-lock.json')) {
    console.log('Synchronizing package-lock.json...');
    await runChecked(
      $`npm install --package-lock-only --ignore-scripts --no-audit`
    );
  }

  console.log('\n✅ Version bump complete with synchronized package-lock.json');
} catch (error) {
  console.error('Error during version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
