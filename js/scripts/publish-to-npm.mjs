#!/usr/bin/env bun

/**
 * Publish to npm using OIDC trusted publishing
 * Usage: bun scripts/publish-to-npm.mjs [--should-pull]
 *   should_pull: Optional flag to pull latest changes before publishing (for release job)
 *
 * Reliable success detection (prevents false-positive releases):
 *   command-stream's `$` does NOT throw on a non-zero exit code (errexit is
 *   off by default — see issue #156). A bare `await $`cmd`` therefore never
 *   rejects, so a try/catch around it can never observe a failure. An early
 *   version of this script relied on that catch, so a failed
 *   `changeset publish` (e.g. npm E404) was silently reported as a success —
 *   which created a GitHub release (`js-v0.10.1`) for a version that never
 *   reached npm (#166). Output scanning, the exit code and a registry check are
 *   therefore all required.
 *
 * Reliable failure detection (prevents false-negative releases):
 *   The registry check must be *bounded polling*, not a single sample. npm
 *   serves package metadata from read replicas, so a version can be published
 *   and still answer 404 for several seconds. Issue #199: command-stream@0.20.1
 *   published successfully, failed a single verification 2s later, was
 *   republished, and npm answered
 *   `E409 ... Cannot publish over previously staged version "0.20.1"` — which
 *   the old code counted as a hard failure. The release was red while the
 *   package was live on npm.
 *
 *   Both concerns now live in scripts/publish-retry.mjs: the publish command is
 *   retried only when the publish itself failed, and an "already published" or
 *   "already staged" conflict is a cue to verify rather than to fail.
 *
 * Verbose tracing:
 *   Set CI_SCRIPTS_DEBUG=1 (or re-run the job with GitHub's debug logging, which
 *   sets RUNNER_DEBUG=1) to emit `::debug::` lines describing every publish and
 *   verification decision. Off by default.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, appendFileSync } from 'fs';
import { debug } from './debug-print.mjs';
import { isPackageVersionPublished } from './npm-registry.mjs';
import {
  buildAuthFailureGuidance,
  isNonRetryableFailure,
} from './publish-failure-classifier.mjs';
import {
  DEFAULT_VERIFY_ATTEMPTS,
  DEFAULT_VERIFY_INITIAL_DELAY,
  DEFAULT_VERIFY_MAX_DELAY,
  isAlreadyPublishedError,
  publishWithRetry,
  sleep,
} from './publish-retry.mjs';

const FALLBACK_PACKAGE_NAME = 'command-stream';

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
// tests/publish-to-npm.test.mjs). Defaults are tuned for real CI runs.
const RETRY_DELAY = Number(process.env.PUBLISH_RETRY_DELAY ?? 10000); // ms
const VERIFY_DELAY = Number(
  process.env.PUBLISH_VERIFY_DELAY ?? DEFAULT_VERIFY_INITIAL_DELAY
); // ms
const VERIFY_ATTEMPTS = Number(
  process.env.PUBLISH_VERIFY_ATTEMPTS ?? DEFAULT_VERIFY_ATTEMPTS
);
const VERIFY_MAX_DELAY = Number(
  process.env.PUBLISH_VERIFY_MAX_DELAY ?? DEFAULT_VERIFY_MAX_DELAY
);
// Registry used for the publication check only. Unset in production, where
// npm-registry.mjs falls back to NPM_CONFIG_REGISTRY and then to
// https://registry.npmjs.org. Tests point it at a stub registry; overriding
// NPM_CONFIG_REGISTRY instead would also redirect use-m's own module
// installation, which must keep talking to the real registry.
const REGISTRY_URL = process.env.PUBLISH_REGISTRY_URL || undefined;

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
 *
 * Reads the registry metadata document directly instead of shelling out to
 * `npm view`: `npm view` mixes registry state with local cache/auth
 * configuration, and its E404 is indistinguishable from a network hiccup.
 *
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
async function verifyPublished(packageName, version) {
  const published = await isPackageVersionPublished(packageName, version, {
    registryUrl: REGISTRY_URL,
  });
  debug('registry verification', { packageName, version, published });
  return published;
}

/**
 * Run `changeset:publish` once and report what happened.
 *
 * command-stream does not throw on non-zero exits, so the output and exit code
 * are captured and classified here. Registry verification is *not* done here:
 * it belongs to publishWithRetry, which must never republish just because a
 * verification sample missed.
 *
 * @returns {Promise<{success: boolean, error: Error|null, output: string}>}
 */
async function attemptPublish() {
  // IMPORTANT: capture:true mirrors output to the console *and* returns it,
  // so CI logs stay readable while we still get the text and exit code.
  const result = await $`bun run changeset:publish`.run({ capture: true });

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  debug('changeset publish exit code', result.code);

  // An "already published"/"already staged" conflict proves the version exists.
  // Report it verbatim so publishWithRetry moves to verification instead of
  // republishing (issue #199).
  if (isAlreadyPublishedError(combinedOutput)) {
    return {
      success: false,
      error: new Error('npm reports this version is already on the registry'),
      output: combinedOutput,
    };
  }

  // Layer 1: scan output for known failure signatures.
  const failurePattern = detectPublishFailure(combinedOutput);
  if (failurePattern) {
    const error = new Error(`detected "${failurePattern}" in publish output`);
    // Auth / registry-configuration failures repeat identically on every retry.
    error.nonRetryable = isNonRetryableFailure(combinedOutput);
    return { success: false, error, output: combinedOutput };
  }

  // Layer 2: trust the exit code when it is non-zero.
  if (result.code !== 0) {
    const error = new Error(
      `changeset publish exited with code ${result.code}`
    );
    error.nonRetryable = isNonRetryableFailure(combinedOutput);
    return { success: false, error, output: combinedOutput };
  }

  return { success: true, error: null, output: combinedOutput };
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
    const packageName = packageJson.name || FALLBACK_PACKAGE_NAME;
    console.log(`Current version to publish: ${currentVersion}`);
    debug('resolved package', { packageName, currentVersion });

    // Check if this version is already published on npm
    console.log(
      `Checking if version ${currentVersion} is already published...`
    );
    if (await verifyPublished(packageName, currentVersion)) {
      console.log(`Version ${currentVersion} is already published to npm`);
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      setOutput('already_published', 'true');
      return;
    }

    console.log(
      `Version ${currentVersion} not found on npm, proceeding with publish...`
    );

    // Publish to npm using OIDC trusted publishing.
    //  - the publish command is retried only when the publish itself failed
    //    (#166: a silent failure must never be reported as a release), and
    //  - verification polls the registry with exponential backoff instead of
    //    sampling it once (#199: a propagation lag must never be reported as a
    //    failure).
    const { success, error } = await publishWithRetry({
      publish: attemptPublish,
      verify: () => verifyPublished(packageName, currentVersion),
      maxRetries: MAX_RETRIES,
      retryDelay: RETRY_DELAY,
      sleepFn: sleep,
      log: console.log,
      verifyOptions: {
        attempts: VERIFY_ATTEMPTS,
        initialDelay: VERIFY_DELAY,
        maxDelay: VERIFY_MAX_DELAY,
      },
    });

    if (success) {
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      console.log(`✅ Published ${packageName}@${currentVersion} to npm`);
      return;
    }

    console.error(`❌ Failed to publish ${packageName}@${currentVersion}`);
    console.error(`Reason: ${error?.message}`);
    if (error?.nonRetryable && !error?.verificationFailed) {
      console.error(buildAuthFailureGuidance(packageName));
      console.error(
        'Hint: an npm E404 on PUT usually means OIDC trusted publishing is not ' +
          'configured for this workflow file. npm allows only one workflow file ' +
          'as a trusted publisher; if the release workflow was renamed (e.g. ' +
          'release.yml -> js.yml), update the trusted publisher on npmjs.com. ' +
          'See docs/case-studies/issue-166/README.md.'
      );
    }
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
