#!/usr/bin/env bun

/**
 * Publish the Rust package to crates.io.
 *
 * The script is idempotent for release retries: if the exact package version is
 * already present on crates.io, it reports success instead of attempting a
 * duplicate publish.
 *
 * Usage:
 *   bun scripts/publish-to-crates.mjs --working-dir rust
 *
 * Environment:
 *   CARGO_REGISTRY_TOKEN: Cargo's native crates.io token, preferred
 *   CARGO_TOKEN: Backwards-compatible token name used by older workflows
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_WORKING_DIR = 'rust';
const CRATES_IO_BASE_URL = (
  process.env.CRATES_IO_BASE_URL || 'https://crates.io/api/v1'
).replace(/\/$/, '');
const MAX_RETRIES = Number.parseInt(
  process.env.CRATES_PUBLISH_MAX_RETRIES || '3',
  10
);
const RETRY_DELAY_MS = Number.parseInt(
  process.env.CRATES_PUBLISH_RETRY_DELAY_MS || '30000',
  10
);

function toCamelCase(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const name = toCamelCase(rawName);

    if (inlineValue !== undefined) {
      args[name] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[name] = argv[index + 1];
      index += 1;
    } else {
      args[name] = true;
    }
  }

  return args;
}

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

function readPackageMetadata(cargoTomlPath) {
  const cargoToml = readFileSync(cargoTomlPath, 'utf8');
  const metadata = {};
  let inPackageSection = false;

  for (const line of cargoToml.split(/\r?\n/)) {
    if (/^\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }

    if (/^\[/.test(line)) {
      inPackageSection = false;
    }

    if (!inPackageSection) {
      continue;
    }

    const match = line.match(/^(name|version)\s*=\s*"([^"]+)"/);
    if (match) {
      metadata[match[1]] = match[2];
    }
  }

  const { name, version } = metadata;
  if (!name || !version) {
    throw new Error(
      `Could not read package name and version from ${cargoTomlPath}`
    );
  }

  return { name, version };
}

async function isVersionPublished(packageName, packageVersion) {
  const url = `${CRATES_IO_BASE_URL}/crates/${encodeURIComponent(
    packageName
  )}/${encodeURIComponent(packageVersion)}`;

  console.log(`Checking crates.io for ${packageName}@${packageVersion}`);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'link-foundation/command-stream publish-to-crates',
    },
  });

  if (response.status === 200) {
    return true;
  }

  if (response.status === 404) {
    return false;
  }

  const body = await response.text().catch(() => '');
  throw new Error(
    `Unexpected crates.io response ${response.status} for ${url}: ${body}`
  );
}

function isAlreadyPublishedOutput(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes('already uploaded') ||
    normalized.includes('already exists') ||
    normalized.includes('crate version is already uploaded')
  );
}

function isRetryablePublishOutput(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes('no matching package named') ||
    normalized.includes('failed to select a version') ||
    normalized.includes('download of config.json failed') ||
    normalized.includes('failed to get successful http response')
  );
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function publishPackage(cargoTomlPath, token) {
  const result = spawnSync(
    'cargo',
    [
      'publish',
      '--allow-dirty',
      '--manifest-path',
      cargoTomlPath,
      '--token',
      token,
    ],
    { encoding: 'utf8' }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workingDir =
    args.workingDir || process.env.WORKING_DIR || DEFAULT_WORKING_DIR;
  const cargoTomlPath = resolve(process.cwd(), workingDir, 'Cargo.toml');
  const cargoPackage = readPackageMetadata(cargoTomlPath);
  const token = process.env.CARGO_REGISTRY_TOKEN || process.env.CARGO_TOKEN;

  console.log(
    `Preparing to publish ${cargoPackage.name}@${cargoPackage.version} from ${cargoTomlPath}`
  );

  if (await isVersionPublished(cargoPackage.name, cargoPackage.version)) {
    console.log(
      `${cargoPackage.name}@${cargoPackage.version} is already published to crates.io`
    );
    setOutput('published', 'true');
    setOutput('published_version', cargoPackage.version);
    setOutput('already_published', 'true');
    setOutput('publish_result', 'already_published');
    return;
  }

  if (!token) {
    console.error(
      'Missing crates.io token. Set CARGO_REGISTRY_TOKEN or CARGO_TOKEN in repository or organization secrets.'
    );
    process.exit(1);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    console.log(`cargo publish attempt ${attempt} of ${MAX_RETRIES}`);
    const result = publishPackage(cargoTomlPath, token);
    const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;

    if (result.status === 0) {
      setOutput('published', 'true');
      setOutput('published_version', cargoPackage.version);
      setOutput('already_published', 'false');
      setOutput('publish_result', 'published');
      console.log(
        `Published ${cargoPackage.name}@${cargoPackage.version} to crates.io`
      );
      return;
    }

    if (isAlreadyPublishedOutput(combinedOutput)) {
      setOutput('published', 'true');
      setOutput('published_version', cargoPackage.version);
      setOutput('already_published', 'true');
      setOutput('publish_result', 'already_published');
      console.log(
        `${cargoPackage.name}@${cargoPackage.version} is already published to crates.io`
      );
      return;
    }

    if (attempt < MAX_RETRIES && isRetryablePublishOutput(combinedOutput)) {
      console.log(
        `cargo publish failed with a retryable registry/index error; retrying in ${RETRY_DELAY_MS / 1000}s`
      );
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    const status = result.status ?? 1;
    console.error(`cargo publish failed with exit code ${status}`);
    process.exit(status);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
