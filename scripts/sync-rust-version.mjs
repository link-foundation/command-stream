#!/usr/bin/env bun

/**
 * Keep the Rust crate version aligned with package.json releases.
 *
 * Usage:
 *   bun scripts/sync-rust-version.mjs
 *   bun scripts/sync-rust-version.mjs --version 1.2.3
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_PACKAGE_JSON = 'package.json';
const DEFAULT_CARGO_TOML = 'rust/Cargo.toml';
const DEFAULT_CARGO_LOCK = 'rust/Cargo.lock';

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

function readPackageJsonVersion(packageJsonPath) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.version) {
    throw new Error(`No version found in ${packageJsonPath}`);
  }
  return packageJson.version;
}

function assertVersion(version) {
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new Error(`Invalid semver version: ${version}`);
  }
}

function readCargoPackageMetadata(cargoToml) {
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

  if (!metadata.name || !metadata.version) {
    throw new Error('Could not read package name and version from Cargo.toml');
  }

  return metadata;
}

function replaceCargoTomlVersion(cargoToml, version) {
  let inPackageSection = false;
  let replaced = false;

  const lines = cargoToml.split(/\r?\n/).map((line) => {
    if (/^\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      return line;
    }

    if (/^\[/.test(line)) {
      inPackageSection = false;
    }

    if (inPackageSection && /^version\s*=\s*"[^"]+"/.test(line)) {
      replaced = true;
      return line.replace(/^version\s*=\s*"[^"]+"/, `version = "${version}"`);
    }

    return line;
  });

  if (!replaced) {
    throw new Error('Could not replace package version in Cargo.toml');
  }

  return lines.join('\n');
}

function replaceCargoLockVersion(cargoLock, packageName, version) {
  const lines = cargoLock.split(/\r?\n/);
  let inPackageSection = false;
  let currentPackageName = null;
  let replaced = false;

  const updatedLines = lines.map((line) => {
    if (/^\[\[package\]\]\s*$/.test(line)) {
      inPackageSection = true;
      currentPackageName = null;
      return line;
    }

    if (inPackageSection) {
      const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
      if (nameMatch) {
        currentPackageName = nameMatch[1];
      }

      if (
        currentPackageName === packageName &&
        /^version\s*=\s*"[^"]+"/.test(line)
      ) {
        replaced = true;
        return line.replace(/^version\s*=\s*"[^"]+"/, `version = "${version}"`);
      }
    }

    return line;
  });

  if (!replaced) {
    throw new Error(`Could not replace ${packageName} version in Cargo.lock`);
  }

  return updatedLines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJsonPath = args.packageJson || DEFAULT_PACKAGE_JSON;
  const cargoTomlPath = args.cargoToml || DEFAULT_CARGO_TOML;
  const cargoLockPath = args.cargoLock || DEFAULT_CARGO_LOCK;
  const version = args.version || readPackageJsonVersion(packageJsonPath);

  assertVersion(version);

  const cargoToml = readFileSync(cargoTomlPath, 'utf8');
  const cargoPackage = readCargoPackageMetadata(cargoToml);

  if (cargoPackage.version !== version) {
    writeFileSync(cargoTomlPath, replaceCargoTomlVersion(cargoToml, version));
    console.log(
      `Updated ${cargoTomlPath}: ${cargoPackage.version} -> ${version}`
    );
  } else {
    console.log(`${cargoTomlPath} already uses ${version}`);
  }

  if (!existsSync(cargoLockPath)) {
    console.log(`${cargoLockPath} not found; skipping lockfile sync`);
    return;
  }

  const cargoLock = readFileSync(cargoLockPath, 'utf8');
  const updatedCargoLock = replaceCargoLockVersion(
    cargoLock,
    cargoPackage.name,
    version
  );

  if (updatedCargoLock !== cargoLock) {
    writeFileSync(cargoLockPath, updatedCargoLock);
    console.log(`Updated ${cargoLockPath}: ${cargoPackage.name} -> ${version}`);
  } else {
    console.log(`${cargoLockPath} already uses ${version}`);
  }
}

try {
  main();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
