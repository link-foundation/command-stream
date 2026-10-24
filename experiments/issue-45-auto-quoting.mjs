// Compare issue #45's pre-quoted interpolation across command-stream, sh,
// Bun's shell, zx, and execa.
//
// Run all available competitors through zx's package environment:
//   bunx --bun zx experiments/issue-45-auto-quoting.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { $ as commandStream$ } from '../js/src/$.mjs';

const PRINTER = fileURLToPath(
  new URL('../js/tests/fixtures/argprint.mjs', import.meta.url)
);
const VALUES = [
  '"already quoted"',
  "'already quoted'",
  '"it\'s still one argument"',
  '"$HOME; echo not-executed"',
];

const argsOf = (stdout) =>
  [...stdout.matchAll(/^ARG\[([\s\S]*?)\]$/gm)].map((match) => match[1]);

const shReference = (value) =>
  argsOf(
    execFileSync('/bin/sh', ['-c', 'node "$1" "$V"', 'issue-45', PRINTER], {
      env: { ...process.env, V: value },
      encoding: 'utf8',
    })
  );

async function optionalImport(name) {
  try {
    return await import(name);
  } catch {
    return null;
  }
}

const zx = await optionalImport('zx');
const execaModule = await optionalImport('execa');

const runners = {
  'command-stream': async (value) =>
    argsOf(
      (await commandStream$({ mirror: false })`node ${PRINTER} ${value}`).stdout
    ),
  'Bun $':
    typeof Bun === 'undefined'
      ? null
      : async (value) =>
          argsOf(
            (await Bun.$`node ${PRINTER} ${value}`.quiet()).stdout.toString()
          ),
  'zx $': zx
    ? async (value) =>
        argsOf((await zx.$({ quiet: true })`node ${PRINTER} ${value}`).stdout)
    : null,
  execa: execaModule?.execa
    ? async (value) =>
        argsOf(
          `${(await execaModule.execa`node ${PRINTER} ${value}`).stdout}\n`
        )
    : null,
};

let failures = 0;
for (const value of VALUES) {
  const expected = shReference(value);
  console.log(`\nvalue ${JSON.stringify(value)}`);
  console.log(`  ${'sh "$V"'.padEnd(16)} ${JSON.stringify(expected)}`);

  for (const [name, run] of Object.entries(runners)) {
    if (!run) {
      console.log(`  ${name.padEnd(16)} unavailable`);
      continue;
    }
    const actual = await run(value);
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    failures += matches ? 0 : 1;
    console.log(
      `  ${name.padEnd(16)} ${matches ? 'same' : 'DIFFERS'} ${JSON.stringify(actual)}`
    );
  }
}

console.log(`\nfailures: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
