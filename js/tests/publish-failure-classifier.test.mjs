// Unit tests for js/scripts/publish-failure-classifier.mjs
//
// Auth / registry-configuration failures repeat identically on every retry.
// Retrying them only hides the real cause behind a generic
// "Failed to publish after N attempts" message.

import { test, expect } from 'bun:test';
import {
  NON_RETRYABLE_PATTERNS,
  buildAuthFailureGuidance,
  isNonRetryableFailure,
} from '../scripts/publish-failure-classifier.mjs';

test('classifies auth and registry-configuration failures as non-retryable', () => {
  for (const pattern of NON_RETRYABLE_PATTERNS) {
    expect(
      isNonRetryableFailure(`prefix ${pattern.toUpperCase()} suffix`)
    ).toBe(true);
  }
});

test('classifies the OIDC bootstrap E404 as non-retryable', () => {
  expect(
    isNonRetryableFailure(
      'npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/command-stream'
    )
  ).toBe(true);
});

test('does not classify a transient publish failure as non-retryable', () => {
  expect(isNonRetryableFailure('npm error code E500')).toBe(false);
  expect(isNonRetryableFailure('packages failed to publish')).toBe(false);
  expect(isNonRetryableFailure('')).toBe(false);
  expect(isNonRetryableFailure(undefined)).toBe(false);
});

test('guidance names the package and points at trusted publishing', () => {
  const guidance = buildAuthFailureGuidance('command-stream');
  expect(guidance).toContain('command-stream');
  expect(guidance).toContain('https://docs.npmjs.com/trusted-publishers');
  expect(guidance).toContain('NPM_TOKEN');
});
