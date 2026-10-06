// Compare every maintained package's declarations with the registry's latest
// stable release. Rust-script's embedded Cargo manifests count too.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const issuePattern =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/;
const sections = ['dependencies', 'dev-dependencies', 'build-dependencies'];

function cargoDependencies(text, file) {
  const manifest = Bun.TOML.parse(text);
  const result = [];
  const lines = text.split('\n');
  const usedLines = new Set();
  const tables = [manifest, ...Object.values(manifest.target ?? {})];
  for (const table of tables) {
    for (const section of sections) {
      for (const [alias, value] of Object.entries(table[section] ?? {})) {
        if (value.path) {
          continue;
        }
        const version = typeof value === 'string' ? value : value.version;
        const line = lines.findIndex(
          (row, index) =>
            !usedLines.has(index) &&
            row.split('=')[0].trim().replace(/^"|"$/g, '') === alias
        );
        usedLines.add(line);
        result.push({
          ecosystem: 'cargo',
          name: value.package ?? alias,
          version,
          file,
          line: line + 1,
          blocker: lines[line]?.split('#')[1]?.match(issuePattern)?.[0],
        });
      }
    }
  }
  return result;
}

/** Collect direct package and development dependencies without network access. */
export function collectDependencies(root = repoRoot) {
  const deps = [];
  const npmFile = 'js/package.json';
  const npmText = readFileSync(join(root, npmFile), 'utf8');
  const npm = JSON.parse(npmText);
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    for (const [name, version] of Object.entries(npm[section] ?? {})) {
      deps.push({
        ecosystem: 'npm',
        name,
        version,
        file: npmFile,
        line:
          npmText.split('\n').findIndex((row) => row.includes(`"${name}"`)) + 1,
      });
    }
  }
  for (const file of ['rust/Cargo.toml', 'rust/benchmarks/Cargo.toml']) {
    deps.push(
      ...cargoDependencies(readFileSync(join(root, file), 'utf8'), file)
    );
  }
  for (const name of readdirSync(join(root, 'rust/scripts')).sort()) {
    if (!name.endsWith('.rs')) {
      continue;
    }
    const file = `rust/scripts/${name}`;
    let inManifest = false;
    const text = readFileSync(join(root, file), 'utf8')
      .split('\n')
      .map((row) => {
        if (row === '//! ```cargo') {
          inManifest = true;
          return '';
        }
        if (row === '//! ```') {
          inManifest = false;
          return '';
        }
        return inManifest ? row.replace(/^\/\/! ?/, '') : '';
      })
      .join('\n');
    deps.push(...cargoDependencies(text, file));
  }
  return deps;
}

/** CI tools with explicit package versions are dependencies as well. */
export function collectToolDependencies(root = repoRoot) {
  const deps = [];
  for (const name of readdirSync(join(root, '.github/workflows')).sort()) {
    const file = `.github/workflows/${name}`;
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    for (const [index, row] of lines.entries()) {
      const cargo = row.match(/cargo install ([\w-]+) --version ([\w.+-]+)/);
      const cargoTool = row.match(/tool: ([\w-]+)@([\w.+-]+)/);
      const npm = row.match(/-p ([@\w/.-]+)@([\d.]+)/);
      const match = cargo ?? cargoTool ?? npm;
      if (match) {
        deps.push({
          ecosystem: cargo || cargoTool ? 'cargo' : 'npm',
          name: match[1],
          version: match[2],
          file,
          line: index + 1,
          blocker: row.split('#')[1]?.match(issuePattern)?.[0],
        });
      }
    }
  }
  const file = 'js/scripts/setup-npm.mjs';
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const index = lines.findIndex((row) =>
    row.includes('export const NPM_TARGET_MAJOR =')
  );
  deps.push({
    ecosystem: 'npm',
    name: 'npm',
    version: lines[index].match(/= (\d+)/)[1],
    majorOnly: true,
    file,
    line: index + 1,
  });
  return deps;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'command-stream-dependency-freshness' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function checkOne(dep, getJson, report) {
  const location = `${dep.file}:${dep.line} (${dep.name})`;
  try {
    const url =
      dep.ecosystem === 'npm'
        ? `https://registry.npmjs.org/${encodeURIComponent(dep.name)}/latest`
        : `https://crates.io/api/v1/crates/${dep.name}`;
    const data = await getJson(url);
    const latest =
      dep.ecosystem === 'npm'
        ? (data.version ?? data['dist-tags']?.latest)
        : data.crate?.max_stable_version;
    if (!latest || typeof dep.version !== 'string') {
      throw new Error(
        'Missing registry version or unsupported dependency declaration'
      );
    }
    // Require an up-to-date lower bound as well as an up-to-date lockfile.
    // This also catches a new major release outside a caret range, which
    // `cargo update` alone cannot fix. Build metadata is not precedence.
    const declared = dep.version.replace(/^[~^=\s]+/, '').split('+')[0];
    if (
      declared === (dep.majorOnly ? latest.split('.')[0] : latest.split('+')[0])
    ) {
      return;
    }
    if (dep.blocker) {
      const [, owner, repo, number] = dep.blocker.match(issuePattern);
      const issue = await getJson(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}`
      );
      if (issue.state === 'open' && !issue.pull_request) {
        report.exemptions.push(
          `${location}: ${dep.version} blocked by ${dep.blocker}`
        );
        return;
      }
    }
    report.failures.push(
      `${location}: declared ${dep.version}, latest ${latest}`
    );
  } catch (error) {
    report.failures.push(`${location}: ${error.message}`);
  }
}

/** Network failures and closed or invalid blocker issues fail the check. */
export async function checkDependencies(deps, options = {}) {
  const cache = new Map();
  const getJson = (url) => {
    if (!cache.has(url)) {
      cache.set(url, (options.fetchJson ?? fetchJson)(url));
    }
    return cache.get(url);
  };
  const report = { failures: [], exemptions: [] };
  // Bound registry concurrency and share metadata for repeated script deps.
  for (let index = 0; index < deps.length; index += 5) {
    await Promise.all(
      deps.slice(index, index + 5).map((dep) => checkOne(dep, getJson, report))
    );
  }
  return report;
}

if (import.meta.main) {
  const deps = [...collectDependencies(), ...collectToolDependencies()];
  const report = await checkDependencies(deps);
  for (const exemption of report.exemptions) {
    console.log(`Blocker: ${exemption}`);
  }
  for (const failure of report.failures) {
    console.error(failure);
  }
  console.log(
    `Checked ${deps.length} direct dependencies; ${report.failures.length} stale or unverifiable.`
  );
  process.exitCode = report.failures.length ? 1 : 0;
}
