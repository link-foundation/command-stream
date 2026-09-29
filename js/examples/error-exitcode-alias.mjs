#!/usr/bin/env node

/**
 * Handling a failed command through either property name.
 *
 * With `shell.errexit(true)` a non-zero exit throws, and the thrown error
 * carries the status under both names: `code` (Node.js `child_process`) and
 * `exitCode` (Execa, zx, nano-spawn, Bun shell). Code written for either
 * convention works unchanged (issue #38).
 *
 * Run: node js/examples/error-exitcode-alias.mjs
 */

import { $ as $raw, shell } from '../src/$.mjs';

// Keep the example output tidy: capture instead of mirroring child output.
const $ = $raw({ mirror: false });

shell.errexit(true);

// Node.js style: read the status from `error.code`.
try {
  await $`exit 3`;
} catch (error) {
  console.log(`node style    -> error.code = ${error.code}`);
}

// Execa/zx style: read the very same status from `error.exitCode`.
try {
  await $`node -e "process.exit(42)"`;
} catch (error) {
  console.log(`execa style   -> error.exitCode = ${error.exitCode}`);
  console.log(
    `result alias  -> error.result.exitCode = ${error.result.exitCode}`
  );
}

// Without errexit a failing command resolves, and the result carries both
// names as well.
shell.errexit(false);
const result = await $`exit 7`;
console.log(
  `result        -> code = ${result.code}, exitCode = ${result.exitCode}`
);
