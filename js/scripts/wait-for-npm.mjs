#!/usr/bin/env bun

/**
 * Wait for a package version to become available on npm.
 *
 * Issue #166 was a *false-positive* release: a git tag and GitHub release
 * existed for js-v0.10.1, but the package was never installable from npm. This
 * step closes that gap by asserting, after publish, that the exact version is
 * actually queryable on the registry (npm visibility can lag a few seconds
 * after a successful publish). If it never appears, the job fails loudly
 * instead of leaving behind a release nobody can `npm install`.
 *
 * Ported from the js pipeline template
 * (link-foundation/js-ai-driven-development-pipeline-template,
 * scripts/wait-for-npm.mjs), adapted to command-stream's `$` and bun. The pure
 * polling logic is exported so it can be unit-tested without hitting npm.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 *
 * Usage: bun scripts/wait-for-npm.mjs --release-version <version> [--package-name <name>]
 *        [--max-attempts <count>] [--sleep-seconds <count>]
 */

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MAX_ATTEMPTS = 30;
export const DEFAULT_SLEEP_SECONDS = 10;

/**
 * Append a step output (and echo for the run log).
 * @param {string} name
 * @param {string} value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

/**
 * Poll until a specific package version is visible on npm, or attempts run out.
 *
 * The availability check and sleep are injectable so the loop can be unit-tested
 * deterministically without network access or real delays.
 *
 * @param {object} options
 * @param {string} options.packageName
 * @param {string} options.version
 * @param {(packageName: string, version: string) => (boolean | Promise<boolean>)} options.checkAvailability
 * @param {number} [options.maxAttempts]
 * @param {number} [options.sleepSeconds]
 * @param {(seconds: number) => Promise<void>} [options.sleepFn]
 * @param {(message: string) => void} [options.stdout]
 * @returns {Promise<boolean>}
 */
export async function waitForNpmVersion({
  packageName,
  version,
  checkAvailability,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  sleepSeconds = DEFAULT_SLEEP_SECONDS,
  sleepFn = (seconds) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, seconds * 1000)),
  stdout = console.log,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    stdout(
      `Checking npm for ${packageName}@${version} (attempt ${attempt}/${maxAttempts})`
    );

    if (await checkAvailability(packageName, version)) {
      return true;
    }

    if (attempt < maxAttempts) {
      await sleepFn(sleepSeconds);
    }
  }

  return false;
}

function isCliEntryPoint() {
  return (
    typeof process !== 'undefined' &&
    process.argv?.[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  );
}

async function runCli() {
  // Load use-m dynamically (matches the other release scripts in this folder).
  const { use } = eval(
    await (await fetch('https://unpkg.com/use-m/use.js')).text()
  );
  const { $ } = await use('command-stream');
  const { makeConfig } = await use('lino-arguments');

  const config = makeConfig({
    yargs: ({ yargs, getenv }) =>
      yargs
        .option('release-version', {
          type: 'string',
          default: getenv('VERSION', ''),
          describe: 'Version number to wait for (e.g., 1.0.0)',
        })
        .option('package-name', {
          type: 'string',
          default: getenv('PACKAGE_NAME', ''),
          describe: 'npm package name (defaults to ./package.json name)',
        })
        .option('max-attempts', {
          type: 'number',
          default: Number(getenv('MAX_ATTEMPTS', String(DEFAULT_MAX_ATTEMPTS))),
          describe: 'Maximum number of polling attempts',
        })
        .option('sleep-seconds', {
          type: 'number',
          default: Number(
            getenv('SLEEP_SECONDS', String(DEFAULT_SLEEP_SECONDS))
          ),
          describe: 'Seconds to wait between attempts',
        }),
  });

  const version = config.releaseVersion;
  if (!version) {
    console.error('Error: Missing required --release-version');
    return 1;
  }

  const packageName =
    config.packageName ||
    JSON.parse(readFileSync('./package.json', 'utf8')).name;

  // command-stream's `$` does NOT throw on non-zero exit (errexit off by
  // default — see issue #156); `npm view <pkg>@<version> version` exits 0 and
  // prints the version when published, non-zero (E404) otherwise.
  const checkAvailability = async (name, ver) => {
    const result = await $`npm view "${name}@${ver}" version`.run({
      capture: true,
    });
    return result.code === 0 && result.stdout.trim() === ver;
  };

  const available = await waitForNpmVersion({
    packageName,
    version,
    checkAvailability,
    maxAttempts: config.maxAttempts,
    sleepSeconds: config.sleepSeconds,
  });

  setOutput('npm_available', available ? 'true' : 'false');

  if (!available) {
    console.error(`${packageName}@${version} did not become available on npm`);
    return 1;
  }

  console.log(`${packageName}@${version} is available on npm`);
  return 0;
}

if (isCliEntryPoint()) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
