// Competitor comparison for issue #41: how does an interpolated path with
// spaces (or quotes) reach the child process in each library?
//
// Reference: `prog "$V"` in /bin/sh - the value is always one argument.
// Run with: bun experiments/issue-41-competitors.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { $ } from '../js/src/$.mjs';

const PRINTER = fileURLToPath(
  new URL('../js/tests/fixtures/argprint.mjs', import.meta.url)
);

const VALUES = [
  '/Users/john/My Documents/report.txt',
  "'/tmp/pre single quoted/f.txt'",
  '"/tmp/pre double quoted/f.txt"',
  "/tmp/it's a dir/f.txt",
  '/tmp/$HOME dir/f.txt',
];

const parse = (stdout) =>
  [...stdout.matchAll(/^ARG\[([\s\S]*?)\]$/gm)].map((m) => m[1]);

const shReference = (value) =>
  parse(
    execFileSync('/bin/sh', ['-c', `node ${PRINTER} "$V"`], {
      env: { ...process.env, V: value },
      encoding: 'utf8',
    })
  );

const commandStream = async (value) =>
  parse((await $({ mirror: false })`node ${PRINTER} ${value}`).stdout);

async function bunShell(value) {
  if (typeof Bun === 'undefined') {
    return null;
  }
  const { $: bun$ } = await import('bun');
  return parse(
    (await bun$`node ${PRINTER} ${value}`.quiet()).stdout.toString()
  );
}

async function execaRun(value) {
  try {
    const { execa } = await import('execa');
    return parse((await execa`node ${PRINTER} ${value}`).stdout + '\n');
  } catch {
    return null; // not installed
  }
}

for (const value of VALUES) {
  const expected = shReference(value);
  const rows = {
    'sh "$V"': expected,
    'command-stream': await commandStream(value),
    'bun $': await bunShell(value),
    execa: await execaRun(value),
  };
  console.log(`\nvalue ${JSON.stringify(value)}`);
  for (const [name, args] of Object.entries(rows)) {
    if (args === null) {
      console.log(`  ${name.padEnd(14)} (not available here)`);
      continue;
    }
    const same = JSON.stringify(args) === JSON.stringify(expected);
    console.log(
      `  ${name.padEnd(14)} ${same ? 'same as sh' : 'DIFFERS   '} ${JSON.stringify(args)}`
    );
  }
}
