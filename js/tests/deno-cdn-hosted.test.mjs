import { expect, test } from 'bun:test';
import { CdnProbeError } from '../scripts/deno-cdn-retry.mjs';
import { probeHostedCdn } from '../scripts/deno-cdn-hosted.mjs';

const url = 'https://esm.sh/gh/example/project@abc123/js/src/$.mjs';
const diskFull = 'mkdir /esm/npm/.install-274404154: no space left on device';
const importFailure = (specifier = url, status = 500) =>
  new CdnProbeError(
    1,
    `\u001b[31merror\u001b[0m: Uncaught (in promise) TypeError: Import '${specifier}' failed: ${status} Internal Server Error`
  );

function fixture(overrides = {}) {
  const failure = importFailure();
  const requests = [];
  const messages = [];
  const settings = {
    eventName: 'pull_request',
    probe: async () => {
      throw failure;
    },
    fetch: async (specifier) => {
      requests.push(specifier);
      return new Response(diskFull, { status: 500 });
    },
    log: (message) => messages.push(message),
    ...overrides,
  };
  return { failure, requests, messages, settings };
}

test('a passing hosted probe needs no outage request', async () => {
  const { settings, requests, messages } = fixture({ probe: async () => {} });
  await probeHostedCdn(url, settings);
  expect(requests).toEqual([]);
  expect(messages).toEqual([]);
});

test('PRs report only the verified esm.sh storage outage as skipped', async () => {
  const { settings, requests, messages } = fixture();
  await probeHostedCdn(url, settings);
  expect(requests).toEqual([url]);
  expect(messages.join('\n')).toContain('Skipping');
  expect(messages.join('\n')).toContain('no space left on device');
  expect(messages.join('\n')).toContain('checkout HTTP probe');
});

test.each(['push', 'workflow_dispatch', undefined])(
  'a storage outage stays fatal with recovery instructions for %s',
  async (eventName) => {
    const { settings } = fixture({ eventName });
    await expect(probeHostedCdn(url, settings)).rejects.toThrow(
      'Ask the esm.sh operator to free storage under /esm/npm, then rerun'
    );
  }
);

test.each([
  new CdnProbeError(1, 'SyntaxError: missing export'),
  new CdnProbeError(1, 'Error: ShellJS process execution failed'),
  importFailure('https://esm.sh/execa@10.2.1'),
  importFailure('https://other.example/module'),
  importFailure(url, 404),
  new Error('deno executable not found'),
])(
  'unrelated failures remain fatal without an outage request: %s',
  async (failure) => {
    const { settings, requests, messages } = fixture({
      probe: async () => {
        throw failure;
      },
    });
    await expect(probeHostedCdn(url, settings)).rejects.toBe(failure);
    expect(requests).toEqual([]);
    expect(messages).toEqual([]);
  }
);

test.each([
  [500, 'could not resolve export'],
  [500, 'other no space left on device error'],
  [503, diskFull],
  [200, diskFull],
])('unconfirmed storage outages stay fatal (%s, %s)', async (status, body) => {
  const { settings, failure } = fixture({
    fetch: async () => new Response(body, { status }),
  });
  await expect(probeHostedCdn(url, settings)).rejects.toBe(failure);
});

test('a failed diagnostic request preserves the original probe failure', async () => {
  const { settings, failure } = fixture({
    fetch: async () => {
      throw new Error('connection reset');
    },
  });
  await expect(probeHostedCdn(url, settings)).rejects.toBe(failure);
});
