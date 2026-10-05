import { test, expect } from 'bun:test';
import {
  checkNpmPublisher,
  checkCratePublisher,
} from '../../.github/scripts/publish-preflight.mjs';

const env = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/token',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test('OIDC environment variables alone cannot pass the publisher check', async () => {
  let calls = 0;
  await expect(
    checkNpmPublisher({
      packageName: 'command-stream',
      env,
      fetchFn: async () =>
        ++calls === 1 ? response({ value: 'identity' }) : response({}, 403),
    })
  ).rejects.toThrow('HTTP 403');
  expect(calls).toBe(2);
});
test('npm validates the package-specific token exchange', async () => {
  const requests = [];
  await checkNpmPublisher({
    packageName: '@scope/package',
    env,
    fetchFn: async (url, options) => {
      requests.push([String(url), options]);
      return response(
        requests.length === 1 ? { value: 'identity' } : { token: 'temporary' }
      );
    },
  });
  expect(requests[0][0]).toContain('audience=npm%3Aregistry.npmjs.org');
  expect(requests[1][0]).toEndWith('/@scope%2fpackage');
  expect(requests[1][1].method).toBe('POST');
  expect(requests[1][1].headers.Authorization).toBe('Bearer identity');
});
test('crates rejects credentials denied by the publish endpoint', async () => {
  await expect(
    checkCratePublisher({
      packageName: 'command-stream',
      env: { CARGO_TOKEN: 'token' },
      fetchFn: async () => response({}, 403),
    })
  ).rejects.toThrow('HTTP 403');
});
test('crates verifies publish scope using a body that cannot publish an archive', async () => {
  let calls = 0;
  await checkCratePublisher({
    packageName: 'command-stream',
    env: { CARGO_REGISTRY_TOKEN: 'token' },
    fetchFn: async (url, options) => {
      calls++;
      expect(url).toBe('https://crates.io/api/v1/crates/new');
      expect(options.method).toBe('PUT');
      const body = Buffer.from(options.body);
      const length = body.readUInt32LE();
      expect(body.length).toBe(length + 4);
      expect(JSON.parse(body.subarray(4)).name).toBe('command-stream');
      return response({ errors: [{ detail: 'invalid tarball length' }] }, 400);
    },
  });
  expect(calls).toBe(1);
});

test('crates rejects unrelated client errors and unexpected success', async () => {
  for (const status of [200, 400, 404, 503]) {
    await expect(
      checkCratePublisher({
        packageName: 'command-stream',
        env: { CARGO_TOKEN: 'token' },
        fetchFn: async () =>
          response({ errors: [{ detail: 'unexpected error' }] }, status),
      })
    ).rejects.toThrow();
  }
});
