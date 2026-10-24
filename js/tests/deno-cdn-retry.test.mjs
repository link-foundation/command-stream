import { test, expect } from 'bun:test';
import { CdnProbeError, retryCdnProbe } from '../scripts/deno-cdn-retry.mjs';

const failedUrl = 'https://esm.sh/execa@10.2.1?target=denonext&conditions=node';
const queued = () =>
  new CdnProbeError(
    1,
    `error: TypeError: Import '${failedUrl}' failed: 408 Request Timeout`
  );

function options(overrides = {}) {
  const delays = [];
  const messages = [];
  return {
    delays,
    messages,
    settings: {
      sleep: async (ms) => delays.push(ms),
      log: (message) => messages.push(message),
      ...overrides,
    },
  };
}

test('a successful CDN probe runs once', async () => {
  let calls = 0;
  const { settings, delays } = options();
  await retryCdnProbe(async () => {
    calls++;
  }, settings);
  expect(calls).toBe(1);
  expect(delays).toEqual([]);
});

test('a transient esm.sh build-queue timeout retries and then passes', async () => {
  let calls = 0;
  const { settings, delays, messages } = options();
  await retryCdnProbe(async () => {
    if (++calls < 3) {
      throw queued();
    }
  }, settings);
  expect(calls).toBe(3);
  expect(delays).toEqual([5000, 10000]);
  expect(messages.join('\n')).toContain(failedUrl);
  expect(messages.join('\n')).toContain('attempt 2/3');
});

test('a persistent timeout fails after the bounded retry budget', async () => {
  let calls = 0;
  const failure = queued();
  const { settings, delays } = options();
  await expect(
    retryCdnProbe(async () => {
      calls++;
      throw failure;
    }, settings)
  ).rejects.toBe(failure);
  expect(calls).toBe(3);
  expect(delays).toEqual([5000, 10000]);
});

test.each([
  new CdnProbeError(1, 'SyntaxError: missing export'),
  new CdnProbeError(
    1,
    "TypeError: Import 'https://esm.sh/broken' failed: 500 Internal Server Error"
  ),
  new CdnProbeError(
    1,
    "TypeError: Import 'https://other.example/module' failed: 408 Request Timeout"
  ),
  new CdnProbeError(1, 'Error: ShellJS process execution failed'),
  new Error('deno executable not found'),
])(
  'runtime, compiler and unrelated failures are not retried: %s',
  async (error) => {
    let calls = 0;
    const { settings, delays } = options();
    await expect(
      retryCdnProbe(async () => {
        calls++;
        throw error;
      }, settings)
    ).rejects.toBe(error);
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  }
);

test('ANSI-formatted Deno errors identify the queued module', async () => {
  let calls = 0;
  const { settings } = options();
  await retryCdnProbe(async () => {
    if (++calls === 1) {
      throw new CdnProbeError(
        1,
        `\u001b[31merror\u001b[0m: TypeError: Import '${failedUrl}' failed: 408 Request Timeout`
      );
    }
  }, settings);
  expect(calls).toBe(2);
});

test('a runtime failure on a retry remains fatal immediately', async () => {
  let calls = 0;
  const failure = new CdnProbeError(1, 'Error: Core command execution failed');
  const { settings, delays } = options();
  await expect(
    retryCdnProbe(async () => {
      throw ++calls === 1 ? queued() : failure;
    }, settings)
  ).rejects.toBe(failure);
  expect(calls).toBe(2);
  expect(delays).toEqual([5000]);
});
