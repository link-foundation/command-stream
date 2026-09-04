#!/usr/bin/env node
// Example for issue #197: translating invocation-scoped `cd` patterns to .mjs.
//
// The built-in `cd` command behaves like POSIX sh/bash within one tagged
// template invocation and restores the host process afterward. Run with:
//   node examples/cd-cwd-sh-translation.mjs
import { $ } from '../src/$.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = mkdtempSync(join(tmpdir(), 'cd-demo-'));
const originalCwd = process.cwd();

try {
  // ---- sh: cd /dir && pwd ----------------------------------------------------
  // cd /dir
  // pwd            # -> /dir
  let r = await $`cd ${root} && pwd`;
  console.log('cd && pwd        ->', r.stdout.trim());

  // ---- separate invocations are isolated -------------------------------------
  await $`cd ${root}`;
  r = await $`pwd`;
  console.log('separate pwd     ->', r.stdout.trim(), '(host cwd)');

  // ---- sh: nested cd within a chain ------------------------------------------
  await $`mkdir -p ${join(root, 'build')}`;
  r = await $`cd ${root} && cd build && pwd`;
  console.log('cd a && cd b     ->', r.stdout.trim());

  // ---- sh: cd - returns to the previous directory and prints it --------------
  r = await $`cd ${root} && cd ${join(root, 'build')} && cd -`;
  console.log('cd -             ->', r.stdout.trim(), '(printed, like sh)');

  // ---- sh: subshell isolation — (cd x) does not affect the parent ------------
  r = await $`cd ${root} ; (cd build && pwd) ; pwd`;
  console.log('(cd b); pwd      ->', JSON.stringify(r.stdout.trim()));

  // ---- the cwd option: a fixed directory without changing process.cwd() ------
  r = await $({ cwd: root })`pwd`;
  console.log('cwd option       ->', r.stdout.trim());
} finally {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
}
