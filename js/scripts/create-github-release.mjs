#!/usr/bin/env bun

/**
 * Create a JavaScript GitHub Release from CHANGELOG.md
 * Usage: bun scripts/create-github-release.mjs --release-version <version> --repository <repository> [--tag-prefix js-v]
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync } from 'fs';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., 1.0.0)',
      })
      .option('repository', {
        type: 'string',
        default: getenv('REPOSITORY', ''),
        describe: 'GitHub repository (e.g., owner/repo)',
      })
      .option('tag-prefix', {
        type: 'string',
        default: getenv('TAG_PREFIX', 'js-v'),
        describe: 'Git tag prefix for JavaScript releases',
      }),
});

const { releaseVersion: version, repository, tagPrefix } = config;

if (!version || !repository) {
  console.error('Error: Missing required arguments');
  console.error(
    'Usage: bun scripts/create-github-release.mjs --release-version <version> --repository <repository>'
  );
  process.exit(1);
}

const tag = `${tagPrefix}${version}`;

// Keep comfortably below GitHub's observed ~125000-character release-body limit.
// A long CHANGELOG section would otherwise make the release API return 422 and
// fail the (now correctly exit-code-checked) step even though npm already
// published — turning a successful publish into a red job. Mirrors the js
// pipeline template's limitReleaseNotesBytes().
const GITHUB_RELEASE_BODY_MAX_BYTES = 120_000;
const textEncoder = new globalThis.TextEncoder();

/**
 * UTF-8 byte length of a string.
 * @param {string} value
 * @returns {number}
 */
function getUtf8ByteLength(value) {
  return textEncoder.encode(value).byteLength;
}

/**
 * Truncate a string so its UTF-8 encoding does not exceed maxBytes, never
 * splitting a multi-byte character.
 * @param {string} value
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateToUtf8Bytes(value, maxBytes) {
  const chunks = [];
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = getUtf8ByteLength(character);
    if (usedBytes + characterBytes > maxBytes) {
      break;
    }
    chunks.push(character);
    usedBytes += characterBytes;
  }
  return chunks.join('');
}

/**
 * Cap release notes to the GitHub body limit, appending a pointer to the full
 * tagged CHANGELOG when truncation happens.
 * @param {string} releaseNotes
 * @returns {string}
 */
function limitReleaseNotesBytes(releaseNotes) {
  if (getUtf8ByteLength(releaseNotes) <= GITHUB_RELEASE_BODY_MAX_BYTES) {
    return releaseNotes;
  }
  const changelogUrl = `https://github.com/${repository}/blob/${tag}/CHANGELOG.md`;
  const suffix = `\n\n...\n\nRelease notes were shortened to fit GitHub's release body limit. See the full tagged CHANGELOG.md: ${changelogUrl}`;
  const availableBytes = Math.max(
    0,
    GITHUB_RELEASE_BODY_MAX_BYTES - getUtf8ByteLength(suffix)
  );
  const shortened = truncateToUtf8Bytes(releaseNotes, availableBytes).trimEnd();
  const limited = `${shortened}${suffix}`;
  return getUtf8ByteLength(limited) <= GITHUB_RELEASE_BODY_MAX_BYTES
    ? limited
    : truncateToUtf8Bytes(limited, GITHUB_RELEASE_BODY_MAX_BYTES);
}

console.log(`Creating JavaScript GitHub release for ${tag}...`);

try {
  // Read CHANGELOG.md
  const changelog = readFileSync('./CHANGELOG.md', 'utf8');

  // Extract changelog entry for this version
  // Read from CHANGELOG.md between this version header and the next version header
  const versionHeaderRegex = new RegExp(`## ${version}[\\s\\S]*?(?=## \\d|$)`);
  const match = changelog.match(versionHeaderRegex);

  let releaseNotes = '';
  if (match) {
    // Remove the version header itself and trim
    releaseNotes = match[0].replace(`## ${version}`, '').trim();
  }

  if (!releaseNotes) {
    releaseNotes = `Release ${version}`;
  }

  // Create release using GitHub API with JSON input
  // This avoids shell escaping issues that occur when passing text via command-line arguments
  // (Previously caused apostrophes like "didn't" to appear as "didn'''" in releases)
  const payload = JSON.stringify({
    tag_name: tag,
    name: `JavaScript ${version}`,
    body: limitReleaseNotesBytes(releaseNotes),
  });

  // command-stream's `$` does NOT throw on a non-zero exit (errexit is off by
  // default — see issue #156), so we must inspect the result code explicitly.
  // Otherwise a failed `gh api` call would be silently reported as a created
  // release (the same false-positive class that produced #166).
  const result =
    await $`gh api repos/${repository}/releases -X POST --input -`.run({
      stdin: payload,
      capture: true,
    });

  if (result.code !== 0) {
    // Idempotency: a self-healing re-run (or a retried job) may try to create a
    // release whose tag already exists. GitHub returns 422 already_exists; that
    // is a success for our purposes, not a failure — so the publish does not
    // get turned into a red job on re-run. Mirrors the template's behaviour.
    const combinedOutput =
      `${result.stderr || ''}\n${result.stdout || ''}`.trim();
    if (/already_exists/i.test(combinedOutput)) {
      console.log(
        `JavaScript GitHub release already exists: ${tag}. Skipping creation.`
      );
    } else {
      throw new Error(
        `gh api failed to create release ${tag} (exit code ${result.code}): ${result.stderr?.trim() || 'no stderr'}`
      );
    }
  } else {
    console.log(`Created JavaScript GitHub release: ${tag}`);
  }
} catch (error) {
  console.error('Error creating release:', error.message);
  process.exit(1);
}
