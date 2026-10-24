#!/usr/bin/env node
// Issue #48: labels/search terms containing spaces reach built-in commands
// with their quotes still attached.
//
// A POSIX shell performs *quote removal* on every word: quotes may appear
// anywhere in a word, and the quoted and unquoted pieces are concatenated into
// a single argument (`label:'help wanted'` is one word, `label:help wanted`).
// command-stream's own tokenizer only stripped quotes when the *whole* word was
// wrapped in them, so `gh search issues label:${label}` (which interpolates as
// `label:'help wanted'`) kept the quotes as literal characters.
//
// This script diffs command-stream against /bin/sh, printing each argument the
// command actually received, so any divergence in word splitting or quote
// removal is visible.
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { $ } from '../js/src/$.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argprint = join(here, '..', 'js', 'tests', 'fixtures', 'argprint.mjs');

// Each case is the argument list appended to a command; `echo` exercises
// command-stream's built-in path, argprint the spawned-process path.
const ARGS = [
  // The shape from the issue: an interpolated value inside a search term.
  "label:'help wanted'",
  'label:"help wanted"',
  "repo:o/r label:'help wanted' is:open",
  "--label='help wanted'",
  '--label="help wanted"',
  // Fully quoted words (these already worked).
  "'help wanted'",
  '"help wanted"',
  // Quotes in the middle / at the end of a word.
  "a'b c'd",
  'a"b c"d',
  "pre'post'",
  "'pre'post",
  // Adjacent quoted sections concatenate into one word.
  "'a''b'",
  '\'a\'"b"',
  "a''b",
  // Empty words.
  "''",
  '""',
  "x '' y",
  // A quote character inside the other kind of quotes stays literal.
  '"it\'s"',
  '\'say "hi"\'',
  "it's",
  // Multiple quoted words on one line.
  "'a b' 'c d'",
  // The POSIX idiom for a literal single quote, as produced by quote().
  "'it'\\''s here'",
];

let failures = 0;
for (const args of ARGS) {
  const sh = spawnSync('/bin/sh', ['-c', `node ${argprint} ${args}`], {
    encoding: 'utf8',
  });
  const expected = sh.stdout;

  let viaEcho;
  try {
    const r = await $({ mirror: false })`${{ raw: `echo ${args}` }}`;
    viaEcho = r.stdout;
  } catch (e) {
    viaEcho = `ERROR ${e.message}`;
  }
  const shEcho = spawnSync('/bin/sh', ['-c', `echo ${args}`], {
    encoding: 'utf8',
  }).stdout;

  let viaSpawn;
  try {
    const r = await $({
      mirror: false,
    })`${{ raw: `node ${argprint} ${args}` }}`;
    viaSpawn = r.stdout;
  } catch (e) {
    viaSpawn = `ERROR ${e.message}`;
  }

  const sameEcho = shEcho === viaEcho;
  const sameSpawn = expected === viaSpawn;
  const same = sameEcho && sameSpawn;
  if (!same) {
    failures++;
  }
  console.log(`${same ? 'OK  ' : 'DIFF'} ${JSON.stringify(args)}`);
  if (!sameEcho) {
    console.log(`      echo   sh: ${JSON.stringify(shEcho)}`);
    console.log(`      echo   cs: ${JSON.stringify(viaEcho)}`);
  }
  if (!sameSpawn) {
    console.log(`      argv   sh: ${JSON.stringify(expected)}`);
    console.log(`      argv   cs: ${JSON.stringify(viaSpawn)}`);
  }
}

console.log(`\n${failures} divergence(s) out of ${ARGS.length}`);
process.exit(failures === 0 ? 0 : 1);
