// Regression tests for js/scripts/publish-retry.mjs
//
// Issue #199: the release job for command-stream@0.20.1 published successfully
// (`🦋 success packages published successfully: command-stream@0.20.1`), then
// verified once 2 seconds later, got a registry-replica E404, republished, and
// npm answered:
//
//   npm error code E409
//   npm error 409 Conflict - PUT https://registry.npmjs.org/command-stream -
//     Cannot publish over previously staged version "0.20.1"
//
// The old loop counted that as a hard failure and turned the release red even
// though 0.20.1 was live on npm. These tests pin both halves of the fix:
//
//   1. an "already published"/"already staged" conflict is a cue to VERIFY,
//      never to fail, and
//   2. verification polls with backoff, so a slow registry is not a failure.
//
// The complementary #166 guarantee (a publish that never reached npm must never
// be reported as a release) is asserted too, so the fix cannot regress into a
// false positive.

import { test, expect } from 'bun:test';
import {
  ALREADY_PUBLISHED_PATTERNS,
  isAlreadyPublishedError,
  publishWithRetry,
  shouldVerify,
  waitForVersionOnRegistry,
} from '../scripts/publish-retry.mjs';

const noSleep = async () => {};

// The verbatim npm output from the failed run, trimmed to the relevant lines.
// Source: dev/log/issues/199/pulls/200/ci-logs/run-33914574283.log
const E409_STAGED_OUTPUT = [
  'npm error code E409',
  'npm error 409 Conflict - PUT https://registry.npmjs.org/command-stream - Cannot publish over previously staged version "0.20.1"',
  '🦋  error an error occurred while publishing command-stream: E409 Conflict',
].join('\n');

test('recognises npm E409 "previously staged version" as already published', () => {
  expect(isAlreadyPublishedError(E409_STAGED_OUTPUT)).toBe(true);
});

test('recognises the classic "previously published version" conflict too', () => {
  expect(
    isAlreadyPublishedError(
      'npm error You cannot publish over the previously published versions: 0.20.1.'
    )
  ).toBe(true);
});

test('does not treat an ordinary publish error as already published', () => {
  expect(
    isAlreadyPublishedError(
      'npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/command-stream'
    )
  ).toBe(false);
  expect(isAlreadyPublishedError('')).toBe(false);
  expect(isAlreadyPublishedError(undefined)).toBe(false);
});

test('every already-published pattern is matched case-insensitively', () => {
  for (const pattern of ALREADY_PUBLISHED_PATTERNS) {
    expect(isAlreadyPublishedError(pattern.toUpperCase())).toBe(true);
  }
});

test('shouldVerify routes an E409 conflict to verification', () => {
  expect(
    shouldVerify({
      success: false,
      error: new Error('changeset publish exited with code 1'),
      output: E409_STAGED_OUTPUT,
    })
  ).toBe(true);
});

test('shouldVerify does not route an unrelated failure to verification', () => {
  expect(
    shouldVerify({
      success: false,
      error: new Error('changeset publish exited with code 1'),
      output: 'npm error code E404',
    })
  ).toBe(false);
});

test('waitForVersionOnRegistry returns true as soon as the version appears', async () => {
  let calls = 0;
  const found = await waitForVersionOnRegistry({
    verify: async () => ++calls >= 3,
    attempts: 7,
    initialDelay: 0,
    maxDelay: 0,
    sleepFn: noSleep,
  });

  expect(found).toBe(true);
  expect(calls).toBe(3);
});

test('waitForVersionOnRegistry keeps polling through transient errors', async () => {
  let calls = 0;
  const found = await waitForVersionOnRegistry({
    verify: async () => {
      calls++;
      if (calls < 3) {
        throw new Error('ECONNRESET');
      }
      return true;
    },
    attempts: 5,
    initialDelay: 0,
    maxDelay: 0,
    sleepFn: noSleep,
  });

  expect(found).toBe(true);
  expect(calls).toBe(3);
});

test('waitForVersionOnRegistry gives up after the configured attempts', async () => {
  let calls = 0;
  const found = await waitForVersionOnRegistry({
    verify: async () => {
      calls++;
      return false;
    },
    attempts: 4,
    initialDelay: 0,
    maxDelay: 0,
    sleepFn: noSleep,
  });

  expect(found).toBe(false);
  expect(calls).toBe(4);
});

test('issue #199: a slow registry after a successful publish is not a failure', async () => {
  // The exact shape of the failed run: publish succeeds, the first verification
  // sample misses, the next one finds the version.
  let publishCalls = 0;
  let verifyCalls = 0;

  const result = await publishWithRetry({
    publish: async () => {
      publishCalls++;
      return {
        success: true,
        error: null,
        output: '🦋  success packages published successfully',
      };
    },
    verify: async () => ++verifyCalls >= 2,
    maxRetries: 3,
    retryDelay: 0,
    sleepFn: noSleep,
    verifyOptions: { attempts: 7, initialDelay: 0, maxDelay: 0 },
  });

  expect(result.success).toBe(true);
  // The publish command must run exactly once: republishing is what produced
  // the E409 that turned the 0.20.1 release red.
  expect(publishCalls).toBe(1);
  expect(verifyCalls).toBe(2);
});

test('issue #199: an E409 staged conflict resolves to success once verified', async () => {
  let publishCalls = 0;

  const result = await publishWithRetry({
    publish: async () => {
      publishCalls++;
      return {
        success: false,
        error: new Error('detected "npm error code e" in publish output'),
        output: E409_STAGED_OUTPUT,
      };
    },
    verify: async () => true,
    maxRetries: 3,
    retryDelay: 0,
    sleepFn: noSleep,
    verifyOptions: { attempts: 7, initialDelay: 0, maxDelay: 0 },
  });

  expect(result.success).toBe(true);
  expect(publishCalls).toBe(1);
});

test('issue #166: a publish that never reaches npm is still a failure', async () => {
  const result = await publishWithRetry({
    publish: async () => ({
      success: true,
      error: null,
      output: 'no projects to publish',
    }),
    verify: async () => false,
    maxRetries: 3,
    retryDelay: 0,
    sleepFn: noSleep,
    verifyOptions: { attempts: 3, initialDelay: 0, maxDelay: 0 },
  });

  expect(result.success).toBe(false);
  expect(result.error.verificationFailed).toBe(true);
  expect(result.error.nonRetryable).toBe(true);
});

test('a genuinely failing publish is retried up to maxRetries', async () => {
  let publishCalls = 0;

  const result = await publishWithRetry({
    publish: async () => {
      publishCalls++;
      return {
        success: false,
        error: new Error('changeset publish exited with code 1'),
        output: 'packages failed to publish',
      };
    },
    verify: async () => false,
    maxRetries: 3,
    retryDelay: 0,
    sleepFn: noSleep,
    verifyOptions: { attempts: 1, initialDelay: 0, maxDelay: 0 },
  });

  expect(result.success).toBe(false);
  expect(publishCalls).toBe(3);
});

test('a non-retryable auth failure is not retried', async () => {
  let publishCalls = 0;
  const error = new Error('detected "npm error 404" in publish output');
  error.nonRetryable = true;

  const result = await publishWithRetry({
    publish: async () => {
      publishCalls++;
      return { success: false, error, output: 'npm error 404 Not Found - PUT' };
    },
    verify: async () => false,
    maxRetries: 3,
    retryDelay: 0,
    sleepFn: noSleep,
    verifyOptions: { attempts: 1, initialDelay: 0, maxDelay: 0 },
  });

  expect(result.success).toBe(false);
  expect(publishCalls).toBe(1);
});
