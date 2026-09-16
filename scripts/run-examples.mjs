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
import { features } from '../examples/features/catalog.mjs';

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PARITY_START = '<<<PARITY_JSON';
const PARITY_END = 'PARITY_JSON>>>';

// Splits an example's output into the human-readable report and the JSON block.
function splitOutput(output) {
  const start = output.indexOf(PARITY_START);
  if (start === -1) return { report: output, parity: null };

  const end = output.indexOf(PARITY_END, start);
  const json = output.slice(start + PARITY_START.length, end === -1 ? undefined : end).trim();
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
    });
    return { ...splitOutput(stdout), failed: false };
  } catch (error) {
    const stdout = error.stdout ?? '';
    return { ...splitOutput(stdout), failed: true, stderr: error.stderr ?? String(error) };
  }
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
      differences.push(`observation ${i} is "${b.label}", expected "${a.label}"`);
    } else if (JSON.stringify(a.value) !== JSON.stringify(b.value)) {
      differences.push(`"${a.label}": ${JSON.stringify(b.value)} instead of ${JSON.stringify(a.value)}`);
    }
  }
  return differences;
}

export async function runExamples({ runtimes = availableRuntimes() } = {}) {
  const results = [];

  for (const feature of features) {
    const file = path.join(root, feature.file);
    if (!fs.existsSync(file)) {
      throw new Error(`Catalog entry "${feature.id}" points at a missing file: ${feature.file}`);
    }

    const runs = {};
    for (const runtime of runtimes) {
      runs[runtime.id] = await runOne(runtime, file);
    }

    const differences = [];
    const [first, ...rest] = runtimes;
    const reference = runs[first.id];

    if (reference.failed) {
      differences.push(`${first.label} failed: ${(reference.stderr ?? '').trim().split('\n').pop()}`);
    }

    for (const runtime of rest) {
      const run = runs[runtime.id];
      if (run.failed && !reference.failed) {
        differences.push(`${runtime.label} failed while ${first.label} succeeded`);
        continue;
      }
      if (!run.parity || !reference.parity) {
        differences.push(`${runtime.label} produced no parity block`);
        continue;
      }
      for (const difference of compare(reference.parity.observations, run.parity.observations)) {
        differences.push(`${runtime.label}: ${difference}`);
      }
      if (JSON.stringify(run.parity.failure) !== JSON.stringify(reference.parity.failure)) {
        differences.push(`${runtime.label}: error ${JSON.stringify(run.parity.failure)} instead of ${JSON.stringify(reference.parity.failure)}`);
      }
    }

    results.push({
      id: feature.id,
      title: feature.title,
      parity: differences.length === 0,
      differences,
      runs,
      source: fs.readFileSync(file, 'utf8'),
    });
  }

  return { runtimes, features: results };
}
