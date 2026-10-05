// Unit tests for js/scripts/setup-npm.mjs version-gating helpers.
//
// Issue #166 (cause #1): the npm publish failed with an opaque E404 because the
// runner's npm did not support OIDC trusted publishing. setup-npm.mjs now hard-
// asserts an OIDC-capable npm (>= 11.5.1) and the Node baseline, failing loudly
// instead of letting the publish step discover it. These tests cover the pure
// gating logic without fetching dependencies or mutating the global npm install.
//
// Ported from the js pipeline template (tests/setup-npm.test.js), adapted to
// bun:test.

import { test, expect } from 'bun:test';

import {
  NODE_MIN_VERSION,
  NPM_MIN_VERSION,
  compareVersions,
  isSupportedNodeVersion,
  isSupportedNpmVersion,
  selectLatestSupportedNpmRelease,
} from '../scripts/setup-npm.mjs';

function makeNpmMetadata(versions) {
  return {
    versions: Object.fromEntries(
      versions.map((version) => [
        version,
        {
          dist: {
            tarball: `https://registry.npmjs.org/npm/-/npm-${version}.tgz`,
          },
        },
      ])
    ),
  };
}

test('compares semantic versions numerically', () => {
  expect(compareVersions('11.10.0', '11.9.9')).toBe(1);
  expect(compareVersions('11.5.1', '11.5.1')).toBe(0);
  expect(compareVersions('11.5.0', '11.5.1')).toBe(-1);
});

test(`requires npm ${NPM_MIN_VERSION} or later for OIDC`, () => {
  expect(isSupportedNpmVersion('11.4.2')).toBe(false);
  expect(isSupportedNpmVersion('11.5.0')).toBe(false);
  expect(isSupportedNpmVersion('11.5.1')).toBe(true);
  expect(isSupportedNpmVersion('11.12.1')).toBe(true);
});

test(`requires Node.js ${NODE_MIN_VERSION} or later`, () => {
  expect(isSupportedNodeVersion('v22.13.1')).toBe(false);
  expect(isSupportedNodeVersion('v22.14.0')).toBe(true);
  expect(isSupportedNodeVersion('v24.0.0')).toBe(true);
});

test('selects the latest npm 11 tarball that satisfies trusted publishing', () => {
  const release = selectLatestSupportedNpmRelease(
    makeNpmMetadata([
      '11.4.2',
      '11.5.0',
      '11.5.1',
      '11.6.0-beta.0',
      '11.10.0',
      '12.0.0',
    ])
  );

  expect(release).toEqual({
    version: '11.10.0',
    tarballUrl: 'https://registry.npmjs.org/npm/-/npm-11.10.0.tgz',
  });
});
