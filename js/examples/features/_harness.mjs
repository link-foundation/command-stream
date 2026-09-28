// Shared harness for the feature examples.
//
// Every example in this directory describes one feature of command-stream and
// records what that feature actually produced. Running an example prints a
// readable report; running it with COMMAND_STREAM_PARITY=1 additionally prints a
// JSON block that `scripts/check-parity.mjs` compares between runtimes.
//
// Recorded values are redacted, so the report of an example is identical in
// every runtime, on every machine and in every checkout.
import fs from 'fs';
import os from 'os';
import path from 'path';

export const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';

export const runtimeLabel = runtime === 'bun' ? 'Bun' : 'Node.js';

export const PARITY_START = '<<<PARITY_JSON';
export const PARITY_END = 'PARITY_JSON>>>';

const redactions = [];
const tempDirs = [];

// Registers a string that must never appear in recorded output, because it
// differs between machines or runtimes.
export function redact(value, placeholder) {
  if (value) {
    redactions.push([value, placeholder]);
  }
}

redact(process.cwd(), '<cwd>');
redact(os.tmpdir(), '<tmp>');

// Creates a throwaway directory that is redacted and removed automatically.
export function makeTempDir(name = 'example') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `command-stream-${name}-`));
  tempDirs.push(dir);
  redact(dir, `<${name}-dir>`);
  return dir;
}

function cleanup() {
  while (tempDirs.length) {
    try {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

function sanitize(value) {
  if (value && typeof value.toJSON === 'function') {
    return sanitize(value.toJSON());
  }
  if (typeof value === 'string') {
    let out = value;
    // Longest needle first, so a temp directory is replaced as a whole instead
    // of having its `os.tmpdir()` prefix swapped out from under it.
    for (const [needle, placeholder] of [...redactions].sort(
      (a, b) => b[0].length - a[0].length
    )) {
      out = out.split(needle).join(placeholder);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitize(item);
    }
    return out;
  }
  return value;
}

function format(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, null, 0);
}

// Runs one example. `body` receives a `record(label, value)` callback; each
// recorded value becomes one line of the report and one entry of the JSON block.
export async function example(meta, body) {
  const observations = [];
  const record = (label, value) => {
    observations.push({ label, value: sanitize(value) });
  };

  let failure = null;
  try {
    await body({ record });
  } catch (error) {
    failure = sanitize(error?.message ?? String(error));
  } finally {
    cleanup();
  }

  console.log(`# ${meta.id} — ${meta.title}`);
  for (const { label, value } of observations) {
    console.log(`${label}: ${format(value)}`);
  }
  if (failure) {
    console.log(`error: ${format(failure)}`);
  }

  if (process.env.COMMAND_STREAM_PARITY === '1') {
    console.log(PARITY_START);
    console.log(
      JSON.stringify({ id: meta.id, runtime, observations, failure })
    );
    console.log(PARITY_END);
  }

  if (failure) {
    process.exitCode = 1;
  }
}
