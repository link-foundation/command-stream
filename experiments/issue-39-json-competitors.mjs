// Compare JSON interpolation with the literal "$VALUE" contract used by sh.
// Bun, zx, and Execa escape interpolated strings by default; optional packages
// are reported as unavailable instead of being required by this repository.
//
// References:
//   https://bun.com/docs/runtime/shell
//   https://google.github.io/zx/quotes
//   https://github.com/sindresorhus/execa
//
// Run: bun experiments/issue-39-json-competitors.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { $ } from '../js/src/$.mjs';

const ARGV_PRINTER = fileURLToPath(
  new URL('../js/tests/fixtures/argv-json.mjs', import.meta.url)
);
const VALUES = [
  JSON.stringify({ compact: true, number: 42 }),
  JSON.stringify(
    {
      quotes: '"double" and \'single\'',
      special: '$HOME `date` $(echo injected); | &',
      path: 'C:\\Program Files\\app',
      controls: 'line 1\nline 2\tcolumn',
      unicode: '雪 🚀',
    },
    null,
    2
  ),
];

const parse = (stdout) => JSON.parse(String(stdout));

function shReference(value) {
  const result = spawnSync(
    '/bin/sh',
    ['-c', 'node "$ARGV_PRINTER" "$JSON_VALUE"'],
    {
      env: {
        ...process.env,
        ARGV_PRINTER,
        JSON_VALUE: value,
      },
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return parse(result.stdout);
}

async function commandStream(value) {
  return parse(
    (await $({ mirror: false })`node ${ARGV_PRINTER} ${value}`).stdout
  );
}

async function bunShell(value) {
  if (typeof Bun === 'undefined') {
    return null;
  }
  const { $: bun$ } = await import('bun');
  return parse((await bun$`node ${ARGV_PRINTER} ${value}`.quiet()).stdout);
}

async function optionalImport(name) {
  try {
    return await import(name);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

async function zx(value) {
  const module = await optionalImport('zx');
  if (!module) {
    return null;
  }
  const result = await module.$({ quiet: true })`node ${ARGV_PRINTER} ${value}`;
  return parse(result.stdout);
}

async function execa(value) {
  const module = await optionalImport('execa');
  if (!module) {
    return null;
  }
  const result = await module.execa`node ${ARGV_PRINTER} ${value}`;
  return parse(result.stdout);
}

const implementations = [
  ['command-stream', commandStream],
  ['Bun shell', bunShell],
  ['zx', zx],
  ['Execa', execa],
];

let failures = 0;
for (const value of VALUES) {
  const expected = shReference(value);
  console.log(`\nvalue: ${JSON.stringify(value)}`);

  for (const [name, run] of implementations) {
    const actual = await run(value);
    if (actual === null) {
      console.log(`  ${name.padEnd(14)} unavailable`);
      continue;
    }
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    if (name === 'command-stream' && !matches) {
      failures += 1;
    }
    console.log(
      `  ${name.padEnd(14)} ${matches ? 'same as sh' : 'DIFFERS'} ${JSON.stringify(actual)}`
    );
  }
}

process.exitCode = failures === 0 ? 0 : 1;
