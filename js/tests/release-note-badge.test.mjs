import { test, expect } from 'bun:test';
import { hasNpmBadge } from '../scripts/release-note-badge.mjs';

test('formatted notes contain an actual HTTPS npm badge image', () => {
  expect(
    hasNpmBadge(
      '[![npm version](https://img.shields.io/badge/npm-1.4.1-blue.svg)](https://www.npmjs.com/package/command-stream)'
    )
  ).toBe(true);
});

test.each([
  'Fix img.shields.io URL handling',
  '![npm](https://img.shields.io.attacker.invalid/badge/npm-1-blue.svg)',
  '![npm](https://attacker.invalid/img.shields.io/badge/npm-1-blue.svg)',
  '![npm](https://img.shields.io@attacker.invalid/badge/npm-1-blue.svg)',
  '![npm](http://img.shields.io/badge/npm-1-blue.svg)',
  '![build](https://img.shields.io/badge/build-passing-green.svg)',
])('unformatted release notes are not skipped: %s', (body) => {
  expect(hasNpmBadge(body)).toBe(false);
});
