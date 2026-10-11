#!/usr/bin/env bun

/**
 * Version the JavaScript package and commit to main
 * Usage: bun scripts/version-and-commit.mjs --mode <changeset|instant> [--bump-type <type>] [--description <desc>]
 *   changeset: Run changeset version
 *   instant: Run instant version bump with bump_type (patch|minor|major) and optional description
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, appendFileSync, readdirSync } from 'fs';
import { loadUseM } from './use-m-loader.mjs';
import { runChecked } from './run-checked.mjs';
import {
  stageReleaseMetadata,
  pushWithRetry,
  commitReleaseVersion,
} from './release-git.mjs';

// Load use-m dynamically
const use = await loadUseM();

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('mode', {
        type: 'string',
        default: getenv('MODE', 'changeset'),
        describe: 'Version mode: changeset or instant',
        choices: ['changeset', 'instant'],
      })
      .option('bump-type', {
        type: 'string',
        default: getenv('BUMP_TYPE', ''),
        describe: 'Version bump type for instant mode: major, minor, or patch',
      })
      .option('description', {
        type: 'string',
        default: getenv('DESCRIPTION', ''),
        describe: 'Description for instant version bump',
      }),
});

const { mode, bumpType, description } = config;

// Debug: Log parsed configuration
console.log('Parsed configuration:', {
  mode,
  bumpType,
  description: description || '(none)',
});

// Detect if positional arguments were used (common mistake)
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith('--')) {
  console.error('Error: Positional arguments detected!');
  console.error('Command line arguments:', args);
  console.error('');
  console.error(
    'This script requires named arguments (--mode, --bump-type, --description).'
  );
  console.error('Usage:');
  console.error('  Changeset mode:');
  console.error('    bun scripts/version-and-commit.mjs --mode changeset');
  console.error('  Instant mode:');
  console.error(
    '    bun scripts/version-and-commit.mjs --mode instant --bump-type <major|minor|patch> [--description <desc>]'
  );
  console.error('');
  console.error('Examples:');
  console.error(
    '  bun scripts/version-and-commit.mjs --mode instant --bump-type patch --description "Fix bug"'
  );
  console.error('  bun scripts/version-and-commit.mjs --mode changeset');
  process.exit(1);
}

// Validation: Ensure mode is set correctly
if (mode !== 'changeset' && mode !== 'instant') {
  console.error(`Invalid mode: "${mode}". Expected "changeset" or "instant".`);
  console.error('Command line arguments:', process.argv.slice(2));
  process.exit(1);
}

// Validation: Ensure bump type is provided for instant mode
if (mode === 'instant' && !bumpType) {
  console.error('Error: --bump-type is required for instant mode');
  console.error(
    'Usage: bun scripts/version-and-commit.mjs --mode instant --bump-type <major|minor|patch> [--description <desc>]'
  );
  process.exit(1);
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

/**
 * Count changeset files (excluding README.md)
 */
function countChangesets() {
  try {
    const changesetDir = '.changeset';
    const files = readdirSync(changesetDir);
    return files.filter((f) => f.endsWith('.md') && f !== 'README.md').length;
  } catch {
    return 0;
  }
}

/**
 * Get package version
 * @param {string} source - 'local' or 'remote'
 */
async function getVersion(source = 'local') {
  if (source === 'remote') {
    const result = await runChecked($`git show origin/main:js/package.json`);
    return JSON.parse(result.stdout).version;
  }
  return JSON.parse(readFileSync('./package.json', 'utf8')).version;
}

async function main() {
  try {
    // Configure git
    await runChecked($`git config user.name "github-actions[bot]"`);
    await runChecked(
      $`git config user.email "41898282+github-actions[bot]@users.noreply.github.com"`
    );

    // Check if remote main has advanced (handles re-runs after partial success)
    console.log('Checking for remote changes...');
    await runChecked($`git fetch origin main`);

    const localHeadResult = await runChecked($`git rev-parse HEAD`);
    const localHead = localHeadResult.stdout.trim();

    const remoteHeadResult = await runChecked($`git rev-parse origin/main`);
    const remoteHead = remoteHeadResult.stdout.trim();

    if (localHead !== remoteHead) {
      console.log(
        `Remote main has advanced (local: ${localHead}, remote: ${remoteHead})`
      );
      console.log('This may indicate a previous attempt partially succeeded.');

      // Check if the remote version is already the expected bump
      const remoteVersion = await getVersion('remote');
      console.log(`Remote version: ${remoteVersion}`);

      // Check if there are changesets to process
      const changesetCount = countChangesets();

      if (mode === 'changeset' && changesetCount === 0) {
        console.log('No changesets to process and remote has advanced.');
        console.log(
          'Assuming version bump was already completed in a previous attempt.'
        );
        setOutput('version_committed', 'false');
        setOutput('already_released', 'true');
        setOutput('new_version', remoteVersion);
        return;
      } else {
        console.log('Rebasing on remote main to incorporate changes...');
        await runChecked($`git rebase origin/main`);
      }
    }

    // Get current version before bump
    const oldVersion = await getVersion();
    console.log(`Current version: ${oldVersion}`);

    if (mode === 'instant') {
      console.log('Running instant version bump...');
      // Run instant version bump script
      // Rely on command-stream's auto-quoting for proper argument handling
      if (description) {
        await runChecked(
          $`bun scripts/instant-version-bump.mjs --bump-type ${bumpType} --description ${description}`
        );
      } else {
        await runChecked(
          $`bun scripts/instant-version-bump.mjs --bump-type ${bumpType}`
        );
      }
    } else {
      console.log('Running changeset version...');
      // Run changeset version to bump versions and update CHANGELOG
      await runChecked($`bun run changeset:version`);
    }

    // Get new version after bump
    const newVersion = await getVersion();
    console.log(`New version: ${newVersion}`);
    setOutput('new_version', newVersion);

    // Check if there are changes to commit
    const statusResult = await runChecked($`git status --porcelain`);
    const status = statusResult.stdout.trim();

    if (status) {
      console.log('Changes detected, committing...');

      // Stage all changes (package.json, package-lock.json, CHANGELOG.md, deleted changesets)
      stageReleaseMetadata();

      // Commit with version number as message
      commitReleaseVersion(newVersion);

      await pushWithRetry({
        push: () => $`git push origin main`.run({ capture: true }),
        rebase: () => runChecked($`git pull --rebase origin main`),
      });

      console.log('✅ Version bump committed and pushed to main');
      setOutput('version_committed', 'true');
    } else {
      console.log('No changes to commit');
      setOutput('version_committed', 'false');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
