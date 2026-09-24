// Runs the feature examples and collects what each runtime observed.
//
// Used by scripts/check-parity.mjs to compare runtimes and by
// scripts/generate-docs.mjs to put real, captured output into the documentation.
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { availableRuntimes } from './runtimes.mjs';
import {
  features,
  languages as languageCatalog,
  rustApiByFeature,
} from '../js/examples/features/catalog.mjs';

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PARITY_START = '<<<PARITY_JSON';
const PARITY_END = 'PARITY_JSON>>>';

// Splits an example's output into the human-readable report and the JSON block.
function splitOutput(output) {
  const start = output.indexOf(PARITY_START);
  if (start === -1) {
    return { report: output, parity: null };
  }

  const end = output.indexOf(PARITY_END, start);
  const json = output
    .slice(start + PARITY_START.length, end === -1 ? undefined : end)
    .trim();
  return {
    report: output.slice(0, start).trimEnd(),
    parity: JSON.parse(json),
  };
}

async function runOne(runtime, file) {
  const args = [...runtime.runArgs, file];
  try {
    const { stdout } = await execFileAsync(runtime.command, args, {
      cwd: root,
      env: { ...process.env, COMMAND_STREAM_PARITY: '1' },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15_000,
      killSignal: 'SIGKILL',
    });
    return { ...splitOutput(stdout), failed: false };
  } catch (error) {
    const stdout = error.stdout ?? '';
    return {
      ...splitOutput(stdout),
      failed: true,
      stderr: error.stderr ?? String(error),
    };
  }
}

function extractRustFeature(source, id) {
  const startMarker = `// feature:${id}`;
  const endMarker = `// endfeature:${id}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) {
    throw new Error(`Rust example is missing the ${id} source region.`);
  }
  return source.slice(start + startMarker.length, end).trim();
}

async function prepareRustExamples() {
  const sourceFile = path.join(root, 'rust/examples/language_features.rs');
  const source = fs.readFileSync(sourceFile, 'utf8');
  const { stdout: versionOutput } = await execFileAsync(
    'rustc',
    ['--version'],
    {
      cwd: root,
    }
  );
  await execFileAsync(
    'cargo',
    [
      'build',
      '--quiet',
      '--manifest-path',
      'rust/Cargo.toml',
      '--example',
      'language_features',
    ],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 }
  );
  const binary = path.join(
    root,
    'rust/target/debug/examples',
    process.platform === 'win32' ? 'language_features.exe' : 'language_features'
  );
  return {
    binary,
    source,
    version: versionOutput.trim().replace(/^rustc\s+/, ''),
  };
}

async function runRustExample(rust, feature) {
  const result = await runOne(
    { command: rust.binary, runArgs: [], id: 'rust' },
    feature.id
  );
  return {
    ...result,
    source: extractRustFeature(rust.source, feature.id),
  };
}

// Describes the first place where two observation lists disagree.
function compare(reference, other) {
  const differences = [];
  const length = Math.max(reference.length, other.length);
  for (let i = 0; i < length; i++) {
    const a = reference[i];
    const b = other[i];
    if (!a) {
      differences.push(`extra observation "${b.label}"`);
    } else if (!b) {
      differences.push(`missing observation "${a.label}"`);
    } else if (a.label !== b.label) {
      differences.push(
        `observation ${i} is "${b.label}", expected "${a.label}"`
      );
    } else if (JSON.stringify(a.value) !== JSON.stringify(b.value)) {
      differences.push(
        `"${a.label}": ${JSON.stringify(b.value)} instead of ${JSON.stringify(a.value)}`
      );
    }
  }
  return differences;
}

// Validation, execution and comparison intentionally live together so the
// documentation and CI consume exactly the same observations.
// eslint-disable-next-line complexity
export async function runExamples({ runtimes = availableRuntimes() } = {}) {
  if (runtimes.length === 0) {
    throw new Error(
      'No JavaScript runtime is available for the feature examples.'
    );
  }
  const missingRustApi = features.filter(
    (feature) => !rustApiByFeature.has(feature.id)
  );
  if (missingRustApi.length > 0) {
    throw new Error(
      `Rust API catalog is missing: ${missingRustApi.map((feature) => feature.id).join(', ')}`
    );
  }

  const rust = await prepareRustExamples();
  const results = [];

  for (const feature of features) {
    const file = path.join(root, feature.file);
    if (!fs.existsSync(file)) {
      throw new Error(
        `Catalog entry "${feature.id}" points at a missing file: ${feature.file}`
      );
    }

    const runs = {};
    for (const runtime of runtimes) {
      runs[runtime.id] = await runOne(runtime, file);
    }

    const differences = [];
    const [first, ...rest] = runtimes;
    const reference = runs[first.id];

    if (reference.failed) {
      differences.push(
        `${first.label} failed: ${(reference.stderr ?? '').trim().split('\n').pop()}`
      );
    }

    for (const runtime of rest) {
      const run = runs[runtime.id];
      if (run.failed && !reference.failed) {
        differences.push(
          `${runtime.label} failed while ${first.label} succeeded`
        );
        continue;
      }
      if (!run.parity || !reference.parity) {
        differences.push(`${runtime.label} produced no parity block`);
        continue;
      }
      for (const difference of compare(
        reference.parity.observations,
        run.parity.observations
      )) {
        differences.push(`${runtime.label}: ${difference}`);
      }
      if (
        JSON.stringify(run.parity.failure) !==
        JSON.stringify(reference.parity.failure)
      ) {
        differences.push(
          `${runtime.label}: error ${JSON.stringify(run.parity.failure)} instead of ${JSON.stringify(reference.parity.failure)}`
        );
      }
    }

    const rustRun = await runRustExample(rust, feature);
    if (rustRun.failed) {
      differences.push(
        `Rust failed: ${(rustRun.stderr ?? '').trim().split('\n').pop()}`
      );
    } else if (!rustRun.parity) {
      differences.push('Rust produced no feature result block');
    } else if (rustRun.parity.id !== feature.id) {
      differences.push(
        `Rust reported feature ${rustRun.parity.id} instead of ${feature.id}`
      );
    }

    results.push({
      id: feature.id,
      title: feature.title,
      parity: differences.length === 0,
      differences,
      runs,
      source: fs.readFileSync(file, 'utf8'),
      rust: rustRun,
    });
  }

  return {
    runtimes,
    languages: languageCatalog.map((language) =>
      language.id === 'rust'
        ? { ...language, version: rust.version }
        : {
            ...language,
            version: runtimes
              .map((runtime) => `${runtime.label} ${runtime.version}`)
              .join(', '),
          }
    ),
    features: results,
  };
}
