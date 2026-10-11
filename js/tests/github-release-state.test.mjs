// js/scripts/github-release-state.mjs: only a definitive 404 may count as a
// missing GitHub release, otherwise an outage would trigger a release (#216).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { githubReleaseExists } from '../scripts/github-release-state.mjs';

const quiet = { warn() {} };
const lookup = (respond, options = {}) => {
  const requests = [];
  const result = githubReleaseExists('js-v1.4.0', {
    repository: 'link-foundation/command-stream',
    apiUrl: 'https://api.example.test/',
    token: 'token',
    logger: quiet,
    fetchFn: async (url, init) => {
      requests.push({ url, init });
      return respond();
    },
    ...options,
  });
  return { result, requests };
};

describe('githubReleaseExists', () => {
  test('a 404 is a missing release', async () => {
    const { result, requests } = lookup(
      () => new Response('{}', { status: 404 })
    );
    expect(await result).toBe(false);
    expect(requests[0].url).toBe(
      'https://api.example.test/repos/link-foundation/command-stream/releases/tags/js-v1.4.0'
    );
    expect(requests[0].init.headers.Authorization).toBe('Bearer token');
  });

  test('a release for the same tag exists', async () => {
    const { result } = lookup(() =>
      Response.json({ id: 7, tag_name: 'js-v1.4.0' })
    );
    expect(await result).toBe(true);
  });

  test.each([
    ['a server error', () => new Response('', { status: 503 })],
    ['a rate limit', () => new Response('', { status: 403 })],
    ['another tag', () => Response.json({ id: 7, tag_name: 'js-v1.4.1' })],
    ['a malformed body', () => Response.json({ tag_name: 'js-v1.4.0' })],
    [
      'a network error',
      () => {
        throw new Error('ECONNRESET');
      },
    ],
  ])('%s is unknown, not missing', async (_name, respond) => {
    const warnings = [];
    const { result } = lookup(respond, {
      logger: { warn: (line) => warnings.push(line) },
    });
    expect(await result).toBeNull();
    expect(warnings[0]).toStartWith(
      'GitHub release state unknown for js-v1.4.0'
    );
  });

  test('no repository is unknown without a request', async () => {
    const { result, requests } = lookup(() => Response.json({}), {
      repository: '',
    });
    expect(await result).toBeNull();
    expect(requests).toEqual([]);
  });
});

test('the release job re-runs publishing when only the GitHub release is missing', () => {
  // A Windows checkout converts LF to CRLF; the splits below match on `\n`.
  const workflow = readFileSync(
    new URL('../../.github/workflows/js.yml', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const check = workflow
    .split('- name: Check if release is needed\n')[1]
    .split('- name:')[0];
  expect(check).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
  const publish = workflow.split('- name: Publish to npm\n')[1].split('id:')[0];
  expect(publish).toContain(
    "steps.check_release.outputs.github_release_missing == 'true'"
  );
});
