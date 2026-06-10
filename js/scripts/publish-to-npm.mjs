#!/usr/bin/env bun

/**
 * Publish to npm using OIDC trusted publishing
 * Usage: bun scripts/publish-to-npm.mjs [--should-pull]
 *   should_pull: Optional flag to pull latest changes before publishing (for release job)
 *
 * IMPORTANT: Update the PACKAGE_NAME constant below to match your package.json
 *
 * Reliable success detection (prevents false-positive releases):
 *   command-stream's `$` does NOT throw on a non-zero exit code (errexit is
 *   off by default — see issue #156). A bare `await $`cmd`` therefore never
 *   rejects, so a try/catch around it can never observe a failure. The previous
 *   version of this script relied on that catch, so a failed `changeset publish`
 *   (e.g. npm E404) was silently reported as a success — which created a
 *   GitHub release (`js-v0.10.1`) for a version that never reached npm (#166).
 *
 *   This version mirrors the multi-layer detection used by the pipeline
 *   template (link-foundation/js-ai-driven-development-pipeline-template,
 *   originally link-assistant/agent PR #116):
 *     1. scan the captured output for known failure patterns,
 *     2. check the captured exit code, and
 *     3. verify the version is actually visible on npm with `npm view`.
 *   A publish is only reported when all three layers pass.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, appendFileSync } from 'fs';

const PACKAGE_NAME = 'command-stream';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs.option('should-pull', {
      type: 'boolean',
      default: getenv('SHOULD_PULL', false),
      describe: 'Pull latest changes before publishing',
    }),
});

const { shouldPull } = config;
const MAX_RETRIES = 3;
// Configurable so tests can run the retry loop without waiting (see
// tests/publish-to-npm.test.mjs). Defaults to 10s for real CI runs.
const RETRY_DELAY = Number(process.env.PUBLISH_RETRY_DELAY ?? 10000); // ms
// Wait for the npm registry to propagate before verifying a fresh publish.
const VERIFY_DELAY = Number(process.env.PUBLISH_VERIFY_DELAY ?? 2000); // ms

// Patterns that indicate a publish failure in the changeset/npm output.
// `changeset publish` can print these and still exit 0 in some npm versions,
// so output scanning is the most reliable first line of defense.
// Reference: link-assistant/agent PR #116 — prevent false positives in CI/CD.
const FAILURE_PATTERNS = [
  'packages failed to publish',
  'error occurred while publishing',
  'npm error code e',
  'npm error 404',
  'npm error 401',
  'npm error 403',
  'access token expired',
  'eneedauth',
  'exited with code 1',
];

/**
 * Sleep for specified milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
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
 * Check if the combined output contains any known failure pattern.
 * @param {string} output - Combined stdout and stderr
 * @returns {string|null} - The matched failure pattern, or null when clean
 */
function detectPublishFailure(output) {
  const lowerOutput = output.toLowerCase();
  for (const pattern of FAILURE_PATTERNS) {
    if (lowerOutput.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Verify a package version is actually published on npm.
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
async function verifyPublished(packageName, version) {
  const result = await $`npm view "${packageName}@${version}" version`.run({
    capture: true,
  });
  return result.code === 0 && result.stdout.trim().includes(version);
}

/**
 * Run `changeset:publish` once and decide whether it really succeeded.
 *
 * command-stream does not throw on non-zero exits, so we capture the output
 * and apply three independent checks before trusting the result.
 *
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<{success: boolean, error: Error|null}>}
 */
async function attemptPublish(packageName, version) {
  // IMPORTANT: capture:true mirrors output to the console *and* returns it,
  // so CI logs stay readable while we still get the text and exit code.
  const result = await $`bun run changeset:publish`.run({ capture: true });

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;

  // Layer 1: scan output for known failure signatures.
  const failurePattern = detectPublishFailure(combinedOutput);
  if (failurePattern) {
    return {
      success: false,
      error: new Error(`detected "${failurePattern}" in publish output`),
    };
  }

  // Layer 2: trust the exit code when it is non-zero.
  if (result.code !== 0) {
    return {
      success: false,
      error: new Error(`changeset publish exited with code ${result.code}`),
    };
  }

  // Layer 3: confirm the version is really on npm (the ultimate check).
  console.log('Verifying package was published to npm...');
  await sleep(VERIFY_DELAY);
  if (await verifyPublished(packageName, version)) {
    return { success: true, error: null };
  }

  return {
    success: false,
    error: new Error('version not found on npm after publish attempt'),
  };
}

async function main() {
  try {
    if (shouldPull) {
      // Pull the latest changes we just pushed
      await $`git pull origin main`;
    }

    // Get current version
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
    const currentVersion = packageJson.version;
    console.log(`Current version to publish: ${currentVersion}`);

    // Check if this version is already published on npm
    console.log(
      `Checking if version ${currentVersion} is already published...`
    );
    const checkResult =
      await $`npm view "${PACKAGE_NAME}@${currentVersion}" version`.run({
        capture: true,
      });

    // command-stream returns { code: 0 } on success, { code: 1 } on failure (e.g., E404)
    // Exit code 0 means version exists, non-zero means version not found
    if (checkResult.code === 0) {
      console.log(`Version ${currentVersion} is already published to npm`);
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      setOutput('already_published', 'true');
      return;
    } else {
      // Version not found on npm (E404), proceed with publish
      console.log(
        `Version ${currentVersion} not found on npm, proceeding with publish...`
      );
    }

    // Publish to npm using OIDC trusted publishing with retry logic.
    // Multi-layer failure detection prevents false-positive releases (#166).
    for (let i = 1; i <= MAX_RETRIES; i++) {
      console.log(`Publish attempt ${i} of ${MAX_RETRIES}...`);
      const { success, error } = await attemptPublish(
        PACKAGE_NAME,
        currentVersion
      );

      if (success) {
        setOutput('published', 'true');
        setOutput('published_version', currentVersion);
        console.log(`✅ Published ${PACKAGE_NAME}@${currentVersion} to npm`);
        return;
      }

      if (i < MAX_RETRIES) {
        console.log(
          `Publish failed: ${error.message}, waiting ${RETRY_DELAY / 1000}s before retry...`
        );
        await sleep(RETRY_DELAY);
      } else {
        console.error(`Publish attempt ${i} failed: ${error.message}`);
      }
    }

    console.error(`❌ Failed to publish after ${MAX_RETRIES} attempts`);
    console.error(
      'Hint: an npm E404 on PUT usually means OIDC trusted publishing is not ' +
        'configured for this workflow file. npm allows only one workflow file ' +
        'as a trusted publisher; if the release workflow was renamed (e.g. ' +
        'release.yml -> js.yml), update the trusted publisher on npmjs.com. ' +
        'See docs/case-studies/issue-166/README.md.'
    );
    // Ensure no false-positive output leaks to the release job.
    setOutput('published', 'false');
    process.exit(1);
  } catch (error) {
    console.error('Error:', error.message);
    setOutput('published', 'false');
    process.exit(1);
  }
}

main();
