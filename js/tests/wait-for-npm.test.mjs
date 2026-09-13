// Unit tests for js/scripts/wait-for-npm.mjs polling logic.
//
// Issue #166 was a false-positive release: a tag/GitHub release existed for
// js-v0.10.1 but the package was never installable from npm. wait-for-npm.mjs
// asserts post-publish that the exact version is queryable on the registry,
// turning "tagged but not on npm" into a hard CI failure.
//
// These tests exercise the injectable polling loop deterministically — no
// network, no real sleeps.

import { test, expect } from 'bun:test';

import { waitForNpmVersion } from '../scripts/wait-for-npm.mjs';

const noopSleep = async () => {};

test('returns true as soon as the version is visible', async () => {
  let calls = 0;
  const available = await waitForNpmVersion({
    packageName: 'command-stream',
    version: '1.2.3',
    checkAvailability: () => {
      calls++;
      return true;
    },
    maxAttempts: 5,
    sleepFn: noopSleep,
    stdout: () => {},
  });

  expect(available).toBe(true);
  expect(calls).toBe(1);
});

test('polls until the version appears, then succeeds', async () => {
  let calls = 0;
  const available = await waitForNpmVersion({
    packageName: 'command-stream',
    version: '1.2.3',
    // Not visible for the first two attempts, then it shows up.
    checkAvailability: () => {
      calls++;
      return calls >= 3;
    },
    maxAttempts: 5,
    sleepFn: noopSleep,
    stdout: () => {},
  });

  expect(available).toBe(true);
  expect(calls).toBe(3);
});

test('returns false after exhausting all attempts', async () => {
  let calls = 0;
  const available = await waitForNpmVersion({
    packageName: 'command-stream',
    version: '99.99.99',
    checkAvailability: () => {
      calls++;
      return false;
    },
    maxAttempts: 4,
    sleepFn: noopSleep,
    stdout: () => {},
  });

  expect(available).toBe(false);
  // Should try exactly maxAttempts times before giving up.
  expect(calls).toBe(4);
});

test('awaits async availability checks', async () => {
  const available = await waitForNpmVersion({
    packageName: 'command-stream',
    version: '1.2.3',
    checkAvailability: async () => true,
    maxAttempts: 2,
    sleepFn: noopSleep,
    stdout: () => {},
  });

  expect(available).toBe(true);
});
