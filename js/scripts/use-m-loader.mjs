#!/usr/bin/env node

/**
 * Load `use-m` from its CDN, with a timeout, bounded retries and an error that
 * names what failed.
 *
 * Every release script in this folder starts by fetching
 * https://unpkg.com/use-m/use.js and eval-ing it. Eleven scripts did that
 * inline, at module scope, with no timeout and no retry:
 *
 *   const { use } = eval(await (await fetch(USE_M_URL)).text());
 *
 * Three failure modes follow from that shape, and all three were observed
 * while investigating issue #199:
 *
 *   - A network-level failure (DNS, connect, reset) rejects with a bare
 *     `TypeError: fetch failed`, thrown during module initialisation. The
 *     script dies before its first `console.log` and before it writes anything
 *     to GITHUB_OUTPUT, so the job's log names neither the CDN nor the URL. In
 *     the publish tests this surfaced as `Expected to contain: "published=true"
 *     / Received: ""` -- a red release caused by a third-party outage, reported
 *     as a publish defect.
 *   - A CDN error page is HTML, and eval-ing HTML raises `SyntaxError:
 *     Unexpected token '<'`, which points at this repository's code for a
 *     response it never inspected. The status is checked before the eval here.
 *   - A stalled connection has no deadline of its own, so the job burned its
 *     whole `timeout-minutes` on a socket that was never going to answer.
 *
 * A CDN blip is transient by nature, so the fetch is retried with exponential
 * backoff before it is allowed to fail the run at all.
 *
 * Verbose tracing: set CI_SCRIPTS_DEBUG=1 (or re-run the job with GitHub's
 * debug logging) to emit one `::debug::` line per attempt. Off by default.
 *
 * Usage:
 *   import { loadUseM } from './use-m-loader.mjs';
 *   const use = await loadUseM();
 *   const { $ } = await use('command-stream');
 */

import { debug } from './debug-print.mjs';

/** CDN entry point for use-m, kept in one place. */
export const USE_M_URL = 'https://unpkg.com/use-m/use.js';

/** Total attempts, including the first one. */
export const DEFAULT_ATTEMPTS = 3;

/** Per-attempt deadline: a stalled connect must not consume the job's budget. */
export const DEFAULT_TIMEOUT_MS = 15000;

/** Delay before the second attempt; doubled for each attempt after it. */
export const DEFAULT_RETRY_DELAY_MS = 2000;

/** Cached `use`, so a process fetches use.js at most once. */
let cachedUse = null;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch use.js once and evaluate it.
 *
 * @param {{fetchImpl: typeof fetch, url: string, timeoutMs: number}} options
 * @returns {Promise<(name: string) => Promise<unknown>>} use-m's `use`
 */
async function fetchUse({ fetchImpl, url, timeoutMs }) {
  // AbortSignal.timeout is the deadline the bare fetch never had. Node 18+ and
  // Bun both ship it; the scripts here run on nothing older.
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText || ''}`.trim()
    );
  }
  const source = await response.text();
  // use-m ships as an eval-able bundle; this is its documented entry point.
  const evaluated = await eval(source);
  const use = evaluated?.use ?? evaluated?.default?.use;
  if (typeof use !== 'function') {
    const keys =
      evaluated && typeof evaluated === 'object'
        ? `[${Object.keys(evaluated).join(', ')}]`
        : String(evaluated);
    throw new Error(`the bundle did not export a callable "use"; got ${keys}`);
  }
  return use;
}

/**
 * Apply the defaults. Kept apart from `loadUseM` so the retry loop stays under
 * the complexity limit eslint enforces for this repository.
 *
 * @param {Record<string, unknown>} options
 * @returns {{
 *   fetchImpl: typeof fetch,
 *   url: string,
 *   attempts: number,
 *   timeoutMs: number,
 *   retryDelayMs: number,
 *   sleep: (ms: number) => Promise<void>,
 *   cacheable: boolean,
 * }}
 */
function resolveOptions(options) {
  const url = options.url ?? USE_M_URL;
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    url,
    attempts: options.attempts ?? DEFAULT_ATTEMPTS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    sleep: options.sleep ?? wait,
    // Tests inject their own fetch, so a cached `use` from a previous call must
    // not answer for them -- and must not be overwritten by their stub either.
    cacheable: !options.fetchImpl && url === USE_M_URL,
  };
}

/**
 * Readable text for a thrown value, for logs and for the final message.
 * @param {unknown} error
 * @returns {string}
 */
const describeError = (error) => error?.message ?? String(error);

/**
 * Load use-m, retrying a transient CDN failure before failing the run.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   url?: string,
 *   attempts?: number,
 *   timeoutMs?: number,
 *   retryDelayMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [options] injection seams for tests; production passes nothing
 * @returns {Promise<(name: string) => Promise<unknown>>} use-m's `use`
 * @throws {Error} naming the URL, the attempt count and the last cause
 */
export async function loadUseM(options = {}) {
  const {
    fetchImpl,
    url,
    attempts,
    timeoutMs,
    retryDelayMs,
    sleep,
    cacheable,
  } = resolveOptions(options);

  if (cacheable && cachedUse) {
    return cachedUse;
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const use = await fetchUse({ fetchImpl, url, timeoutMs });
      debug('loaded use-m', { url, attempt });
      if (cacheable) {
        cachedUse = use;
      }
      return use;
    } catch (error) {
      lastError = error;
      debug('use-m load attempt failed', {
        url,
        attempt,
        attempts,
        error: describeError(error),
      });
      if (attempt < attempts) {
        await sleep(retryDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  // The message is the whole point of this module: it has to be readable from
  // the CI log alone, and it has to say that the failure is the CDN's rather
  // than this repository's.
  throw new Error(
    `Failed to load use-m from ${url} after ${attempts} attempt(s): ` +
      `${describeError(lastError)}. ` +
      'This is a network dependency of the release scripts, not a defect in ' +
      'the published package; re-run the job when the CDN answers again.',
    { cause: lastError }
  );
}

/**
 * Drop the cached `use`. Only tests need this.
 * @returns {void}
 */
export function resetUseMCache() {
  cachedUse = null;
}
