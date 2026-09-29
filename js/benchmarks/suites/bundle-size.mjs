import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const jsDirectory = dirname(benchmarkDirectory);
const memoryFixture = join(benchmarkDirectory, 'fixtures', 'import-memory.mjs');
const requireFromJs = createRequire(join(jsDirectory, 'package.json'));

const packageConfigurations = [
  {
    name: 'command-stream',
    root: jsDirectory,
    importUrl: pathToFileURL(join(jsDirectory, 'src', '$.mjs')).href,
    fullImport: `import * as api from './src/$.mjs'; globalThis.__benchmark = api`,
    minimalImport: `import { exec } from './src/$.mjs'; globalThis.__benchmark = exec`,
  },
  {
    name: 'execa',
    fullImport: `import * as api from 'execa'; globalThis.__benchmark = api`,
    minimalImport: `import { execa as api } from 'execa'; globalThis.__benchmark = api`,
  },
  { name: 'cross-spawn', full: 'cross-spawn', minimal: 'default' },
  {
    name: 'ShellJS',
    packageName: 'shelljs',
    full: 'shelljs',
    minimal: 'default',
  },
  { name: 'zx', full: 'zx', minimal: '$' },
];

function packageManifest(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
}

function findPackageRoot(packageName, fromDirectory = jsDirectory) {
  let current = resolve(fromDirectory);
  const filesystemRoot = parse(current).root;
  while (true) {
    const candidate = join(current, 'node_modules', ...packageName.split('/'));
    try {
      const manifest = packageManifest(candidate);
      if (manifest.name === packageName) {
        return realpathSync(candidate);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (current === filesystemRoot) {
      break;
    }
    current = dirname(current);
  }
  throw new Error(`Could not locate package root for ${packageName}`);
}

function directorySize(directory) {
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) {
      bytes += directorySize(filename);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      bytes += lstatSync(filename).size;
    }
  }
  return bytes;
}

function dependencyClosureSize(packageRoot, primaryUnpackedBytes) {
  const visited = new Set();
  let total = 0;

  function visit(currentRoot, primary = false) {
    const canonical = realpathSync(currentRoot);
    if (visited.has(canonical)) {
      return;
    }
    visited.add(canonical);
    total += primary ? primaryUnpackedBytes : directorySize(canonical);

    const manifest = packageManifest(canonical);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(findPackageRoot(dependency, canonical));
    }
  }

  visit(packageRoot, true);
  return total;
}

export function parseNpmPackOutput(output, packageRoot = 'package') {
  const parsed = JSON.parse(output);
  const result = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (
    !result ||
    !Number.isFinite(result.size) ||
    !Number.isFinite(result.unpackedSize)
  ) {
    throw new Error(`npm pack returned invalid metrics for ${packageRoot}`);
  }
  return {
    packedBytes: result.size,
    unpackedBytes: result.unpackedSize,
    fileCount: result.entryCount ?? result.files?.length ?? null,
  };
}

function npmPackMetrics(packageRoot) {
  const output = execFileSync(
    'npm',
    ['pack', packageRoot, '--dry-run', '--json', '--ignore-scripts'],
    { cwd: jsDirectory, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  return parseNpmPackOutput(output, packageRoot);
}

function importStatement(packageName, selectedExport) {
  if (selectedExport === packageName) {
    return `import * as api from '${packageName}'; globalThis.__benchmark = api`;
  }
  if (selectedExport === 'default') {
    return `import api from '${packageName}'; globalThis.__benchmark = api`;
  }
  return `import { ${selectedExport} as api } from '${packageName}'; globalThis.__benchmark = api`;
}

async function bundledBytes(source) {
  const result = await build({
    absWorkingDir: jsDirectory,
    bundle: true,
    format: 'esm',
    loader: { '.node': 'file' },
    logLevel: 'silent',
    minify: true,
    platform: 'node',
    outdir: 'benchmark-bundle',
    stdin: {
      contents: source,
      resolveDir: jsDirectory,
      sourcefile: 'benchmark-entry.mjs',
    },
    treeShaking: true,
    write: false,
  });
  return result.outputFiles.reduce(
    (sum, file) => sum + file.contents.byteLength,
    0
  );
}

function measureImportMemory(importUrl) {
  const output = execFileSync(
    'node',
    ['--expose-gc', memoryFixture, importUrl],
    { cwd: jsDirectory, encoding: 'utf8' }
  );
  return JSON.parse(output);
}

async function measurePackage(configuration) {
  const packageName = configuration.packageName ?? configuration.name;
  const packageRoot = configuration.root ?? findPackageRoot(packageName);
  const manifest = packageManifest(packageRoot);
  const pack = npmPackMetrics(packageRoot);
  const fullSource =
    configuration.fullImport ??
    importStatement(packageName, configuration.full);
  const minimalSource =
    configuration.minimalImport ??
    importStatement(packageName, configuration.minimal);
  const [fullBundleBytes, minimalBundleBytes] = await Promise.all([
    bundledBytes(fullSource),
    bundledBytes(minimalSource),
  ]);
  const treeShakingPercent =
    fullBundleBytes === 0
      ? 0
      : Math.max(0, (1 - minimalBundleBytes / fullBundleBytes) * 100);

  return {
    name: configuration.name,
    version: manifest.version,
    packedBytes: pack.packedBytes,
    unpackedBytes: pack.unpackedBytes,
    fileCount: pack.fileCount,
    installedBytes: dependencyClosureSize(packageRoot, pack.unpackedBytes),
    fullBundleBytes,
    minimalBundleBytes,
    treeShakingPercent,
    importMemory: measureImportMemory(
      configuration.importUrl ??
        pathToFileURL(requireFromJs.resolve(packageName)).href
    ),
  };
}

export async function runBundleSizeSuite() {
  const packages = [];
  for (const configuration of packageConfigurations) {
    packages.push(await measurePackage(configuration));
  }
  packages.push({
    name: 'Bun.$',
    version:
      typeof globalThis.Bun === 'undefined'
        ? 'built into Bun'
        : globalThis.Bun.version,
    packedBytes: 0,
    unpackedBytes: 0,
    fileCount: 0,
    installedBytes: 0,
    fullBundleBytes: 0,
    minimalBundleBytes: 0,
    treeShakingPercent: null,
    importMemory: null,
  });

  return {
    kind: 'bundle-size',
    name: 'Package and bundle size',
    methodology:
      'npm pack sizes, recursive production dependency footprint, esbuild minified Node bundles, and fresh-process import memory deltas.',
    packages,
  };
}

export const bundleSizeInternals = {
  directorySize,
  findPackageRoot,
  npmPackMetrics,
};
