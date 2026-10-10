// Run with Deno to reproduce the published CDN import and verify a candidate.
// Usage: deno run -A --no-lock experiments/issue-219/cdn-import.mjs [module-url]
const specifier = Deno.args[0] ?? 'https://esm.sh/command-stream@2.0.0';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { $, shelljs } = await import(specifier);
if (typeof $ !== 'function') {
  throw new Error('The package did not export a callable $');
}
console.log(`Imported ${specifier}: typeof $ = ${typeof $}`);
const result = await $({ mirror: false })`echo hi`;
if (result.stdout.trim() !== 'hi' || result.code !== 0) {
  throw new Error(`Unexpected command result: ${JSON.stringify(result)}`);
}
console.log('Core command execution passed');

if ($.shelljs !== shelljs) {
  throw new Error('ShellJS entry points do not share one implementation');
}
const directory = mkdtempSync(join(tmpdir(), 'command-stream-cdn-'));
try {
  writeFileSync(join(directory, 'a.txt'), 'a\n');
  writeFileSync(join(directory, 'b.txt'), 'b\n');
  if (shelljs.ls(join(directory, '{a,b}.txt')).length !== 2) {
    throw new Error('Normal ShellJS brace expansion failed');
  }
  // Finite 101-level input: the guard must reject before fast-glob traverses.
  const deepDirectory = join(
    directory,
    `${'{'.repeat(101)}a${'}'.repeat(101)}`
  );
  mkdirSync(deepDirectory);
  let rejected = false;
  try {
    shelljs.ls('-R', deepDirectory);
  } catch (error) {
    if (error.code !== 'ERR_SHELLJS_GLOB_DEPTH') {
      throw error;
    }
    rejected = true;
  }
  if (!rejected) {
    throw new Error('The CDN build bypassed the ShellJS glob depth guard');
  }
  console.log('ShellJS normal globs and depth protection passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
