#!/usr/bin/env bun

/**
 * Validate changeset for CI - ensures exactly one valid changeset is added by the PR
 *
 * Key behavior:
 * - Only checks changeset files ADDED by the current PR (not pre-existing ones)
 * - Compares the PR head with its merge base, failing on unavailable refs
 * - Validates that the PR adds exactly one changeset with proper format
 * - Documentation-only changes do not force a package release
 * - Local development without CI refs can check all pending changesets
 *
 * IMPORTANT: Update the package name below to match your package.json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_NAME = 'command-stream';
const CHANGESET_DIR = '.changeset';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function getAddedChangesetFiles() {
  const base =
    process.env.GITHUB_BASE_SHA ||
    process.env.BASE_SHA ||
    (process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`);
  if (!base) {
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      throw new Error('A base reference is required in CI');
    }
    console.log('Local validation: checking all pending changesets');
    return existsSync(CHANGESET_DIR)
      ? readdirSync(CHANGESET_DIR).filter(
          (file) => file.endsWith('.md') && file !== 'README.md'
        )
      : [];
  }
  const head = process.env.GITHUB_HEAD_SHA || process.env.HEAD_SHA || 'HEAD';
  const ancestor = git('merge-base', base, head);
  const prefix = git('rev-parse', '--show-prefix');
  // --no-renames: changesets are mostly frontmatter, so rename detection pairs
  // a new fragment with any one removed in the same range and reports `R`, and
  // the added fragment would not be counted (issue #216).
  const entries = git(
    'diff',
    '--name-status',
    '--no-renames',
    ancestor,
    head,
    '--',
    '.'
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const packagePaths = entries.map((entry) =>
    entry.at(-1).slice(prefix.length)
  );
  const needsRelease = packagePaths.some(
    (file) =>
      /^(src|scripts|types)\//.test(file) ||
      ['package.json', 'package-lock.json', 'bun.lock'].includes(file)
  );
  const added = entries
    .filter(
      ([status, file]) =>
        status === 'A' &&
        file.startsWith(`${prefix}${CHANGESET_DIR}/`) &&
        file.endsWith('.md') &&
        !file.endsWith('/README.md')
    )
    .map(([, file]) => file.slice(`${prefix}${CHANGESET_DIR}/`.length));
  return needsRelease || added.length ? added : null;
}

/**
 * Validate a single changeset file
 * @param {string} filePath Full path to the changeset file
 * @returns {{valid: boolean, type?: string, description?: string, error?: string}}
 */
function validateChangesetFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // Check if changeset has a valid type (major, minor, or patch). Only the
    // frontmatter declares it; the same text in the description does not.
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    const versionTypeRegex = new RegExp(
      `^['"]${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]:\\s+(major|minor|patch)`,
      'm'
    );
    const versionTypeMatch = frontmatter?.match(versionTypeRegex);

    if (!versionTypeMatch) {
      return {
        valid: false,
        error: `Changeset must specify a version type: major, minor, or patch\nExpected format:\n---\n'${PACKAGE_NAME}': patch\n---\n\nYour description here`,
      };
    }

    // Extract description (everything after the closing ---) and check it's not empty
    const parts = content.split('---');
    if (parts.length < 3) {
      return {
        valid: false,
        error:
          "Changeset must include a description of the changes (after the closing '---')",
      };
    }

    const description = parts.slice(2).join('---').trim();
    if (!description) {
      return {
        valid: false,
        error: 'Changeset must include a non-empty description of the changes',
      };
    }

    return {
      valid: true,
      type: versionTypeMatch[1],
      description,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read changeset file: ${error.message}`,
    };
  }
}

try {
  console.log('Validating changesets added by this PR...');

  // Get changeset files added in this PR
  const addedChangesetFiles = getAddedChangesetFiles();
  if (addedChangesetFiles === null) {
    console.log('No JavaScript release changes; a changeset is optional');
    process.exit(0);
  }
  const changesetCount = addedChangesetFiles.length;

  console.log(`Found ${changesetCount} changeset file(s) added by this PR`);
  if (changesetCount > 0) {
    console.log('Added changesets:');
    addedChangesetFiles.forEach((file) => console.log(`  - ${file}`));
  }

  // Ensure exactly one changeset file was added
  if (changesetCount === 0) {
    console.error(
      "::error::No changeset found in this PR. Please add a changeset by running 'bun run changeset' and commit the result."
    );
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(
      `::error::Multiple changesets found in this PR (${changesetCount}). Each PR should add exactly ONE changeset.`
    );
    console.error('::error::Found changeset files added by this PR:');
    addedChangesetFiles.forEach((file) => console.error(`  ${file}`));
    console.error(
      '\n::error::Please combine these into a single changeset or remove the extras.'
    );
    process.exit(1);
  }

  // Validate the single changeset file
  const changesetFile = join(CHANGESET_DIR, addedChangesetFiles[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  const validation = validateChangesetFile(changesetFile);

  if (!validation.valid) {
    console.error(`::error::${validation.error}`);
    console.error(`\nFile content of ${changesetFile}:`);
    try {
      console.error(readFileSync(changesetFile, 'utf-8'));
    } catch {
      console.error('(could not read file)');
    }
    process.exit(1);
  }

  console.log('Changeset validation passed');
  console.log(`   Type: ${validation.type}`);
  console.log(`   Description: ${validation.description}`);
} catch (error) {
  console.error('Error during changeset validation:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
