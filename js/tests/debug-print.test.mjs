// Unit tests for js/scripts/debug-print.mjs
//
// The release scripts keep verbose tracing in the code with the default state
// switched off, so a failing run can be re-run with debug logging and produce
// the evidence needed to find a root cause without a code change.

import { test, expect } from 'bun:test';
import {
  debugWith,
  formatDebugLines,
  isDebugEnabled,
  readEnvVar,
} from '../scripts/debug-print.mjs';

test('debug output is off by default', () => {
  expect(isDebugEnabled({})).toBe(false);
});

test('every documented switch enables debug output', () => {
  expect(isDebugEnabled({ CI_SCRIPTS_DEBUG: '1' })).toBe(true);
  expect(isDebugEnabled({ CI_SCRIPTS_DEBUG: 'true' })).toBe(true);
  expect(isDebugEnabled({ RUNNER_DEBUG: '1' })).toBe(true);
  expect(isDebugEnabled({ ACTIONS_STEP_DEBUG: 'true' })).toBe(true);
});

test('an unreadable environment counts as unset', () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('NotCapable');
      },
    }
  );
  expect(readEnvVar('CI_SCRIPTS_DEBUG', hostile)).toBeUndefined();
  expect(isDebugEnabled(hostile)).toBe(false);
});

test('lines are prefixed for the GitHub Actions debug stream', () => {
  expect(formatDebugLines(['first\nsecond'])).toEqual([
    '::debug::first',
    '::debug::second',
  ]);
});

test('objects are serialized', () => {
  expect(formatDebugLines([{ published: true }])).toEqual([
    '::debug::{',
    '::debug::  "published": true',
    '::debug::}',
  ]);
});

test('nothing is printed while debug output is off', () => {
  const lines = [];
  expect(debugWith({ env: {}, log: (l) => lines.push(l) }, 'hidden')).toEqual(
    []
  );
  expect(lines).toEqual([]);
});

test('lines are printed once debug output is on', () => {
  const lines = [];
  debugWith(
    { env: { CI_SCRIPTS_DEBUG: '1' }, log: (l) => lines.push(l) },
    'visible',
    { code: 0 }
  );
  expect(lines[0]).toBe('::debug::visible {');
});
