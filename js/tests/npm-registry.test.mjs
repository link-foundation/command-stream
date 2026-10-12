// Unit tests for js/scripts/npm-registry.mjs
//
// The publish verification in scripts/publish-to-npm.mjs reads registry
// metadata directly rather than shelling out to `npm view`, because `npm view`
// mixes registry state with local cache/auth configuration and its E404 is
// indistinguishable from a network hiccup (issue #199).

import { test, expect } from 'bun:test';
import {
  buildPackageMetadataUrl,
  encodePackageName,
  isPackageVersionPublished,
  normalizeRegistryUrl,
} from '../scripts/npm-registry.mjs';

function jsonResponse(status, body, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

test('normalizes registry URLs by stripping trailing slashes', () => {
  expect(normalizeRegistryUrl('https://registry.npmjs.org///')).toBe(
    'https://registry.npmjs.org'
  );
  expect(normalizeRegistryUrl('')).toBe('https://registry.npmjs.org');
});

test('encodes unscoped and scoped package names', () => {
  expect(encodePackageName('command-stream')).toBe('command-stream');
  expect(encodePackageName('@scope/pkg')).toBe('@scope%2Fpkg');
});

test('rejects an empty package name', () => {
  expect(() => encodePackageName('')).toThrow('Package name is required');
  expect(() => encodePackageName('   ')).toThrow('Package name is required');
});

test('builds metadata URLs', () => {
  expect(buildPackageMetadataUrl('command-stream')).toBe(
    'https://registry.npmjs.org/command-stream'
  );
  expect(buildPackageMetadataUrl('@scope/pkg')).toBe(
    'https://registry.npmjs.org/@scope%2Fpkg'
  );
});

test('reports a published version as published', async () => {
  const published = await isPackageVersionPublished(
    'command-stream',
    '0.20.1',
    {
      fetchFn: async () =>
        jsonResponse(200, { name: 'command-stream', version: '0.20.1' }),
    }
  );
  expect(published).toBe(true);
});

test('reports a missing version as not published', async () => {
  const published = await isPackageVersionPublished(
    'command-stream',
    '99.99.99',
    {
      fetchFn: async () =>
        jsonResponse(200, { name: 'command-stream', version: '0.20.1' }),
    }
  );
  expect(published).toBe(false);
});

test('treats a 404 as "not published", not an error', async () => {
  const published = await isPackageVersionPublished('brand-new-pkg', '1.0.0', {
    fetchFn: async () => jsonResponse(404, {}, 'Not Found'),
  });
  expect(published).toBe(false);
});

test('surfaces other HTTP failures so polling can retry them', async () => {
  await expect(
    isPackageVersionPublished('command-stream', '0.20.1', {
      fetchFn: async () => jsonResponse(503, {}, 'Service Unavailable'),
    })
  ).rejects.toThrow('503 Service Unavailable');
});

test('requires a version', async () => {
  await expect(
    isPackageVersionPublished('command-stream', '', { fetchFn: async () => {} })
  ).rejects.toThrow('Package version is required');
});

test('honours a custom registry URL', async () => {
  let requestedUrl = '';
  await isPackageVersionPublished('command-stream', '1.0.0', {
    registryUrl: 'https://registry.example.com/',
    fetchFn: async (url) => {
      requestedUrl = url;
      return jsonResponse(200, { name: 'command-stream', version: '1.0.0' });
    },
  });
  expect(new URL(requestedUrl).pathname).toBe('/command-stream/1.0.0');
  expect(new URL(requestedUrl).origin).toBe('https://registry.example.com');
});

test('issue #209: bypasses stale package metadata when the exact version is live', async () => {
  let request;
  const published = await isPackageVersionPublished('command-stream', '1.4.0', {
    fetchFn: async (url, options) => {
      request = { url: new URL(url), options };
      return request.url.pathname === '/command-stream/1.4.0'
        ? jsonResponse(200, { name: 'command-stream', version: '1.4.0' })
        : jsonResponse(200, { versions: { '1.3.0': {} } });
    },
  });
  expect(published).toBe(true);
  expect(request.url.searchParams.has('cache-bust')).toBe(true);
  expect(request.options.headers['cache-control']).toBe('no-cache');
  expect(request.options.signal).toBeInstanceOf(AbortSignal);
});

test('issue #209: does not accept another package with the requested version', async () => {
  expect(
    await isPackageVersionPublished('command-stream', '1.4.0', {
      fetchFn: async () =>
        jsonResponse(200, { name: 'wrong-package', version: '1.4.0' }),
    })
  ).toBe(false);
});
