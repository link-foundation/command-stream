#!/usr/bin/env node
// Compare semantic values, not added diff lines, and fail if Git cannot supply
// either side. Versions are changed only by the release pipeline on main.
import { execFileSync } from 'node:child_process';

try {
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  const base =
    process.env.GITHUB_BASE_SHA ||
    `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
  const head = process.env.GITHUB_HEAD_SHA || 'HEAD';
  const ancestor = git('merge-base', base, head);
  // The workflow invokes this script inside js/. Git paths are repository
  // relative, so determine the prefix instead of assuming a single-package tree.
  const manifest = `${git('rev-parse', '--show-prefix')}package.json`;
  const readVersion = (ref) => {
    const { version } = JSON.parse(git('show', `${ref}:${manifest}`));
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error(`Missing package version at ${ref}`);
    }
    return version;
  };
  if (readVersion(ancestor) !== readVersion(head)) {
    throw new Error(
      'Manual package version changes are prohibited; add a changeset instead'
    );
  }
  console.log('No manual package version changes detected');
} catch (error) {
  console.error(`::error::Version validation failed: ${error.message}`);
  process.exitCode = 1;
}
