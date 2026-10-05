#!/usr/bin/env node

/**
 * Self-healing release detection.
 *
 * Checks whether the current `package.json` (`--working-dir js`) version
 * or `Cargo.toml` (`--working-dir rust`) version has been published to
 * the corresponding registry. If not, signals that a release should
 * happen even without a new changeset/changelog fragment.
 *
 * Why query the registry instead of git tags? Git tags can exist
 * without a published package (e.g., the publish step failed after the
 * tag was pushed). The registry is the source of truth for users.
 *
 * Usage:
 *   node scripts/check-release-needed.mjs --working-dir js --registry npm
 *   node scripts/check-release-needed.mjs --working-dir rust --registry crates.io
 *
 * Env (optional):
 *   HAS_FRAGMENTS  'true' if changelog fragments / changesets exist
 *                  (forces should_release=true, skip_bump=false).
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   should_release  'true' | 'false'
 *   skip_bump       'true' | 'false'
 *
 * Inspired by the link-foundation js/rust pipeline templates.
 * See docs/case-studies/issue-118/comparison-with-templates.md.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { debug, dumpEnv } from "./debug-print.mjs";

function parseArgs(argv) {
  const out = { workingDir: ".", registry: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--working-dir" && argv[index + 1]) {
      out.workingDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--working-dir=")) {
      out.workingDir = arg.slice("--working-dir=".length);
    } else if (arg === "--registry" && argv[index + 1]) {
      out.registry = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--registry=")) {
      out.registry = arg.slice("--registry=".length);
    }
  }
  return out;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  console.log(`Output: ${name}=${value}`);
}

function readPackageJson(workingDir) {
  const file = join(workingDir, "package.json");
  if (!existsSync(file)) {
    throw new Error(`package.json not found at ${file}`);
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!data.name || !data.version) {
    throw new Error(`package.json at ${file} is missing name or version`);
  }
  return { name: data.name, version: data.version };
}

function readCargoToml(workingDir) {
  const file = join(workingDir, "Cargo.toml");
  if (!existsSync(file)) {
    throw new Error(`Cargo.toml not found at ${file}`);
  }
  const content = readFileSync(file, "utf8");

  const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
  const versionMatch = content.match(/^\s*version\s*=\s*"([^"]+)"/m);

  if (!nameMatch || !versionMatch) {
    throw new Error(`Cargo.toml at ${file} is missing name or version in the [package] table`);
  }
  return { name: nameMatch[1], version: versionMatch[1] };
}

async function checkNpm(name, version) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "link-foundation/start check-release-needed" },
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    console.warn(`Warning: npm registry returned HTTP ${response.status} for ${url}; treating as not-published.`);
    return false;
  } catch (error) {
    console.warn(`Warning: npm registry unreachable: ${error.message}; treating as not-published.`);
    return false;
  }
}

async function checkCrates(name, version) {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "link-foundation/start check-release-needed" },
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    console.warn(`Warning: crates.io returned HTTP ${response.status} for ${url}; treating as not-published.`);
    return false;
  } catch (error) {
    console.warn(`Warning: crates.io unreachable: ${error.message}; treating as not-published.`);
    return false;
  }
}

const { workingDir, registry } = parseArgs(process.argv.slice(2));
const resolvedDir = resolve(workingDir);

debug("check-release-needed args:", { workingDir: resolvedDir, registry });
dumpEnv(["GITHUB_OUTPUT", "HAS_FRAGMENTS"]);

if (!registry) {
  console.error("Error: --registry <npm|crates.io> is required");
  process.exit(1);
}

const hasFragments = process.env.HAS_FRAGMENTS === "true";

let pkg;
let isPublished;

if (registry === "npm") {
  pkg = readPackageJson(resolvedDir);
  isPublished = await checkNpm(pkg.name, pkg.version);
} else if (registry === "crates.io" || registry === "crates") {
  pkg = readCargoToml(resolvedDir);
  isPublished = await checkCrates(pkg.name, pkg.version);
} else {
  console.error(`Error: unsupported registry "${registry}". Use "npm" or "crates.io".`);
  process.exit(1);
}

console.log(`Working directory: ${resolvedDir}`);
console.log(`Registry: ${registry}`);
console.log(`Package: ${pkg.name}`);
console.log(`Current version: ${pkg.version}`);
console.log(`Has fragments/changesets: ${hasFragments}`);
console.log(`Already published: ${isPublished}`);

if (hasFragments) {
  setOutput("should_release", "true");
  setOutput("skip_bump", "false");
} else if (isPublished) {
  setOutput("should_release", "false");
  setOutput("skip_bump", "false");
} else {
  // Self-healing: version present locally but not on the registry → publish without bumping
  setOutput("should_release", "true");
  setOutput("skip_bump", "true");
}
