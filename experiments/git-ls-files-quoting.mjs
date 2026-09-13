#!/usr/bin/env node
// Why js/tests/*.test.mjs list tracked files with execFileSync.
//
// `execSync("git ls-files '*.md'")` runs through the platform shell:
// /bin/sh on POSIX, which strips the single quotes, and cmd.exe on Windows,
// which does not. git then looks for a path literally named `'*.md'`, matches
// nothing and exits 0, so the caller sees an empty file list instead of an
// error -- js/tests/docs-validation.test.mjs validated zero documents on the
// Windows leg of the matrix until this was fixed.
//
// This script reproduces the Windows behaviour on any platform by quoting the
// pattern twice, and shows that execFileSync is immune because no shell is
// involved.
import { execSync, execFileSync } from 'child_process';

const count = (out) => out.trim().split('\n').filter(Boolean).length;
const repoRoot = new URL('..', import.meta.url).pathname;
const run = (label, fn) => {
  try {
    console.log(`${label}: ${count(fn())} file(s)`);
  } catch (error) {
    console.log(`${label}: failed with ${error.message.split('\n')[0]}`);
  }
};

run('execSync, shell strips the quotes (POSIX)', () =>
  execSync("git ls-files '*.md'", { cwd: repoRoot, encoding: 'utf8' })
);
run('execSync, quotes reach git (what cmd.exe does)', () =>
  execSync(`git ls-files "'*.md'"`, { cwd: repoRoot, encoding: 'utf8' })
);
run('execFileSync, no shell at all', () =>
  execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
);
