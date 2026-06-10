#!/usr/bin/env bun

/**
 * Check if a release is needed based on changesets and npm registry state.
 *
 * This script checks:
 *   1. If there are changeset files to process, and
 *   2. If the current package.json version has already been published to npm.
 *
 * IMPORTANT: This checks npm (the source of truth for JS packages), NOT git
 * tags / GitHub releases. This is critical because:
 *   - Git tags and GitHub releases can exist without the package being on npm
 *     (exactly what produced the false-positive `js-v0.10.1` release in #166),
 *   - Only npm publication means users can actually `npm install` the package.
 *
 * Self-healing: if a previous release attempt bumped the version and committed
 * it to main but the npm publish failed or was skipped, the repo version is
 * left permanently ahead of npm. By comparing package.json against the
 * registry, the next push to main detects the unpublished version and triggers
 * a catch-up publish.
 *
 * IMPORTANT — this is a deliberate improvement over the upstream template
 * (link-foundation/js-ai-driven-development-pipeline-template,
 * scripts/check-release-needed.mjs, issue #36). The template only probes npm
 * when `has_changesets` is false. But issue #166's "failed to do any deploy"
 * restart (run 27224046292) had `has_changesets=true` *locally* while the
 * version bump had already been consumed on `origin/main` by a prior run — so
 * `changeset version` found nothing, the version step committed nothing, and
 * the publish was gated off, leaving v0.10.2 stranded (npm was still at 0.9.5).
 * To close that gap we ALWAYS probe npm and emit `current_unpublished`, which
 * the workflow uses to publish the current version whether or not a changeset
 * is present. See docs/case-studies/issue-166/.
 *
 * command-stream's `$` does NOT throw on a non-zero exit code (errexit is off
 * by default — see issue #156), so the registry probe checks the captured exit
 * code explicitly instead of relying on a thrown error.
 *
 * Usage: bun scripts/check-release-needed.mjs
 *   (run with working-directory: js, so ./package.json is the JS package)
 *
 * Environment variables:
 *   - HAS_CHANGESETS: 'true' if changeset files exist (from the changeset check)
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - should_release: 'true' if a release should be created
 *   - skip_bump: 'true' if the version bump should be skipped (version already
 *                bumped but not yet published — self-healing path)
 *   - current_unpublished: 'true' if the current package.json version is NOT on
 *                npm. This is the authoritative publish trigger: it is true
 *                whenever the committed version still needs to reach the
 *                registry, regardless of whether a changeset is present, which
 *                is what makes the self-heal cover the #166 restart case.
 */

import { readFileSync, appendFileSync } from 'fs';

// Load use-m dynamically (matches the other release scripts in this folder).
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

const { $ } = await use('command-stream');

/**
 * Append to the GitHub Actions output file (and echo for the run log).
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

/**
 * Read the package name and version from the local package.json.
 * @returns {{ name: string, version: string }}
 */
function getPackageInfo() {
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  return { name: packageJson.name, version: packageJson.version };
}

/**
 * Check whether a specific version is published on npm.
 *
 * command-stream's `$` does not throw on non-zero exit, so we inspect the
 * captured exit code: `npm view <pkg>@<version> version` exits 0 and prints the
 * version when it exists, and exits non-zero (E404) when it does not.
 *
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
async function checkVersionOnNpm(packageName, version) {
  const result = await $`npm view "${packageName}@${version}" version`.run({
    capture: true,
  });
  return result.code === 0 && result.stdout.trim().includes(version);
}

async function main() {
  try {
    const hasChangesets = process.env.HAS_CHANGESETS === 'true';
    const { name: packageName, version: currentVersion } = getPackageInfo();

    console.log(`Package: ${packageName}`);
    console.log(`Current version: ${currentVersion}`);
    console.log(`Has changesets: ${hasChangesets}`);

    // Always probe npm — even with changesets — so a committed-but-unpublished
    // version is detected no matter how the release got into that state (#166).
    console.log(
      `Checking if ${packageName}@${currentVersion} is published on npm...`
    );
    const isPublished = await checkVersionOnNpm(packageName, currentVersion);
    console.log(`Published on npm: ${isPublished}`);
    setOutput('current_unpublished', isPublished ? 'false' : 'true');

    if (hasChangesets) {
      // A changeset normally produces a NEW version via the bump step, so let
      // the bump run (skip_bump=false). If the changeset turns out to be already
      // consumed on the remote, the bump is a no-op and `current_unpublished`
      // (emitted above) still drives the catch-up publish of the current
      // version — the #166 restart case the template's design missed.
      console.log('Found changesets, proceeding with release');
      setOutput('should_release', 'true');
      setOutput('skip_bump', 'false');
      return;
    }

    if (isPublished) {
      console.log(
        `No changesets and v${currentVersion} already published on npm — no release needed`
      );
      setOutput('should_release', 'false');
      setOutput('skip_bump', 'false');
    } else {
      console.log(
        `No changesets but v${currentVersion} not yet published to npm — release needed (self-healing)`
      );
      setOutput('should_release', 'true');
      setOutput('skip_bump', 'true');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
