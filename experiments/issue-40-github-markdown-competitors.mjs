// Compare a complex GitHub Markdown body with sh, Bun, zx, and Execa.
// Optional packages are reported as unavailable rather than required.
//
// Run installed implementations:
//   bun experiments/issue-40-github-markdown-competitors.mjs
// Run all competitors through zx's package environment:
//   bunx --bun zx experiments/issue-40-github-markdown-competitors.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { $ as commandStream$ } from '../js/src/$.mjs';
import { COMPLEX_MARKDOWN_BODY } from '../js/tests/fixtures/complex-markdown-body.mjs';

const ARGV_PRINTER = fileURLToPath(
  new URL('../js/tests/fixtures/argv-json.mjs', import.meta.url)
);
const expected = [COMPLEX_MARKDOWN_BODY];
const parse = (stdout) => JSON.parse(String(stdout));

function shReference() {
  return parse(
    execFileSync('/bin/sh', ['-c', 'node "$ARGV_PRINTER" "$BODY"'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ARGV_PRINTER,
        BODY: COMPLEX_MARKDOWN_BODY,
      },
    })
  );
}

async function optionalImport(name) {
  try {
    return await import(name);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      error?.code === 'MODULE_NOT_FOUND'
    ) {
      return null;
    }
    throw error;
  }
}

const zx = await optionalImport('zx');
const execaModule = await optionalImport('execa');
const runners = {
  'command-stream': async () =>
    parse(
      (
        await commandStream$({
          mirror: false,
        })`node ${ARGV_PRINTER} ${COMPLEX_MARKDOWN_BODY}`
      ).stdout
    ),
  'command-stream "${body}"': async () =>
    parse(
      (
        await commandStream$({
          mirror: false,
        })`node ${ARGV_PRINTER} "${COMPLEX_MARKDOWN_BODY}"`
      ).stdout
    ),
  'Bun $':
    typeof Bun === 'undefined'
      ? null
      : async () =>
          parse(
            (await Bun.$`node ${ARGV_PRINTER} ${COMPLEX_MARKDOWN_BODY}`.quiet())
              .stdout
          ),
  'zx $': zx?.$
    ? async () =>
        parse(
          (
            await zx.$({
              quiet: true,
            })`node ${ARGV_PRINTER} ${COMPLEX_MARKDOWN_BODY}`
          ).stdout
        )
    : null,
  Execa: execaModule?.execa
    ? async () =>
        parse(
          (
            await execaModule.execa`node ${ARGV_PRINTER} ${COMPLEX_MARKDOWN_BODY}`
          ).stdout
        )
    : null,
};

console.log(`sh "$BODY": ${JSON.stringify(shReference())}`);

let failures = 0;
for (const [name, run] of Object.entries(runners)) {
  if (!run) {
    console.log(`${name}: unavailable`);
    continue;
  }

  const actual = await run();
  const matches = JSON.stringify(actual) === JSON.stringify(expected);
  failures += matches ? 0 : 1;
  console.log(`${name}: ${matches ? 'same as sh' : 'DIFFERS'}`);
}

process.exitCode = failures === 0 ? 0 : 1;
