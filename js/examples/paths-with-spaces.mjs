#!/usr/bin/env node
// Working with file paths that contain spaces (issue #41).
// An interpolated value always becomes exactly one argument - the same
// guarantee as "$path" in a POSIX shell - so paths need no manual quoting.
import { $ } from '../src/$.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const $q = $({ mirror: false });

const dir = mkdtempSync(join(tmpdir(), 'my documents '));
const report = join(dir, 'annual report 2026.txt');
const backup = join(dir, 'annual report 2026.backup.txt');
writeFileSync(report, 'quarterly numbers\n');

try {
  // Read a file whose path contains spaces - no quotes in the template.
  console.log((await $q`cat ${report}`).stdout.trim());

  // Several paths with spaces in one command.
  await $q`cp ${report} ${backup}`;
  console.log((await $q`ls ${backup}`).stdout.trim());

  // Redirection and pipelines keep the path in one piece too.
  await $q`echo appended >> ${backup}`;
  console.log((await $q`cat ${backup} | wc -l`).stdout.trim());

  // Enter a directory whose name contains spaces.
  console.log((await $q`cd ${dir} && pwd`).stdout.trim());

  // Do NOT pre-quote: the quotes become part of the file name, exactly as
  // `cat "'$path'"` behaves in sh, so the file is not found.
  const preQuoted = `'${report}'`;
  const missing = await $q`cat ${preQuoted}`;
  console.log(`pre-quoted path fails as in sh: code=${missing.code}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
