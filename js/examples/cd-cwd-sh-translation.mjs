#!/usr/bin/env node
// Example for issue #50: translating `cd` patterns from sh to .mjs.
//
// The built-in `cd` command behaves like `cd` in a POSIX sh/bash script, so a
// shell script translates almost line-for-line. Run with:
//   node examples/cd-cwd-sh-translation.mjs
import { $ } from '../src/$.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = mkdtempSync(join(tmpdir(), 'cd-demo-'));

try {
  // ---- sh: cd /dir && pwd ----------------------------------------------------
  // cd /dir
  // pwd            # -> /dir
  let r = await $`cd ${root} && pwd`;
  console.log('cd && pwd        ->', r.stdout.trim());

  // ---- sh: the change persists across separate commands ----------------------
  // cd /dir
  // pwd            # still /dir on the next line
  await $`cd ${root}`;
  r = await $`pwd`;
  console.log('cd; then pwd     ->', r.stdout.trim());

  // ---- sh: nested cd within a chain ------------------------------------------
  await $`mkdir -p ${join(root, 'build')}`;
  r = await $`cd ${root} && cd build && pwd`;
  console.log('cd a && cd b     ->', r.stdout.trim());

  // ---- sh: cd - returns to the previous directory and prints it --------------
  await $`cd ${root}`;
  await $`cd ${join(root, 'build')}`;
  r = await $`cd -`;
  console.log('cd -             ->', r.stdout.trim(), '(printed, like sh)');

  // ---- sh: subshell isolation — (cd x) does not affect the parent ------------
  await $`cd ${root}`;
  r = await $`(cd build && pwd) ; pwd`;
  console.log('(cd b); pwd      ->', JSON.stringify(r.stdout.trim()));

  // ---- the cwd option: a fixed directory without changing process.cwd() ------
  r = await $({ cwd: root })`pwd`;
  console.log('cwd option       ->', r.stdout.trim());
} finally {
  process.chdir(tmpdir());
  rmSync(root, { recursive: true, force: true });
}
