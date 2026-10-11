/**
 * Look up whether a GitHub release exists for a tag.
 *
 * Only a definitive 404 means "missing". Any other failure (no repository,
 * network error, rate limit, malformed response) returns `null` — unknown —
 * so a GitHub outage can never trigger a release. Adapted from the JS pipeline
 * template's scripts/github-release-state.mjs (issue #216).
 */

import { debug } from './debug-print.mjs';

/**
 * Fetch `GET /repos/{repository}/releases/tags/{tag}`.
 * @returns {Promise<Response>}
 */
function requestRelease(tag, { repository, apiUrl, token, fetchFn }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('GITHUB_REPOSITORY is unavailable');
  }
  const url = `${apiUrl.replace(/\/+$/, '')}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
  debug('github release lookup', { url, authenticated: Boolean(token) });
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetchFn(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
}

/**
 * @param {unknown} release - parsed response body
 * @param {string} tag
 */
function validateRelease(release, tag) {
  if (
    !Number.isInteger(release?.id) ||
    release.id <= 0 ||
    release.tag_name !== tag
  ) {
    throw new Error('Malformed GitHub release response');
  }
}

/**
 * @param {string} tag - release tag, e.g. `js-v1.4.0`
 * @param {object} [options]
 * @param {string} [options.repository] - `owner/repo`
 * @param {string} [options.apiUrl]
 * @param {string} [options.token]
 * @param {typeof fetch} [options.fetchFn]
 * @param {{ warn: (message: string) => void }} [options.logger]
 * @returns {Promise<boolean | null>} true if present, false if missing, null if unknown
 */
export async function githubReleaseExists(
  tag,
  {
    repository = process.env.GITHUB_REPOSITORY,
    apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
    token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    fetchFn = fetch,
    logger = console,
  } = {}
) {
  try {
    const response = await requestRelease(tag, {
      repository,
      apiUrl,
      token,
      fetchFn,
    });
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`GitHub answered HTTP ${response.status}`);
    }
    validateRelease(await response.json(), tag);
    return true;
  } catch (error) {
    logger.warn(`GitHub release state unknown for ${tag}: ${error.message}`);
    return null;
  }
}
