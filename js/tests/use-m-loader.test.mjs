// Unit tests for js/scripts/use-m-loader.mjs
//
// Every release script starts by fetching https://unpkg.com/use-m/use.js and
// eval-ing it. Eleven of them did that inline, at module scope, with no
// timeout and no retry, so a CDN blip killed the script during module
// initialisation: no log line, nothing written to GITHUB_OUTPUT, and a bare
// `TypeError: fetch failed` on stderr. That is a third-party outage reported as
// a publish defect -- the class of false positive issue #199 is about.
//
// These tests pin the four properties that make the failure honest: a deadline,
// bounded retries, a status check before the eval, and an error naming the URL
// and the cause. The network is never touched: `fetchImpl` is injected.
import { test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import {
  loadUseM,
  resetUseMCache,
  USE_M_URL,
  DEFAULT_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
} from '../scripts/use-m-loader.mjs';

const repoRoot = join(dirname(Bun.fileURLToPath(import.meta.url)), '..', '..');

/** A use.js bundle whose evaluation yields `{ use }`, like the real one. */
const BUNDLE = '({ use: async (name) => ({ loaded: name }) })';

/**
 * @param {string} body response body
 * @param {{status?: number, statusText?: string}} [init]
 * @returns {Response}
 */
const respond = (body, init = {}) =>
  new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
  });

/** Records the delays a retry would have slept, without sleeping. */
const recordingSleep = (delays) => async (ms) => {
  delays.push(ms);
};

test('a healthy CDN yields a callable use', async () => {
  const seen = [];
  const use = await loadUseM({
    fetchImpl: async (url, options) => {
      seen.push({ url, hasSignal: Boolean(options?.signal) });
      return respond(BUNDLE);
    },
  });

  expect(typeof use).toBe('function');
  expect(await use('command-stream')).toEqual({ loaded: 'command-stream' });
  expect(seen).toEqual([{ url: USE_M_URL, hasSignal: true }]);
});

// The bare fetch had no deadline of its own, so a stalled connect burned the
// job's whole timeout-minutes on a socket that was never going to answer.
test('every attempt carries an abort deadline', async () => {
  const signals = [];
  await loadUseM({
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      return respond(BUNDLE);
    },
  });

  expect(signals).toHaveLength(1);
  expect(signals[0]).toBeInstanceOf(AbortSignal);
  expect(signals[0].aborted).toBe(false);
});

test('an aborted fetch is reported as a load failure, not a hang', async () => {
  await expect(
    loadUseM({
      attempts: 1,
      timeoutMs: 5,
      fetchImpl: (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(options.signal.reason)
          );
        }),
    })
  ).rejects.toThrow(/Failed to load use-m from https:\/\/unpkg\.com/);
});

// A CDN blip is transient by nature: retrying is the difference between a red
// release and a run that is a couple of seconds slower.
test('a transient failure is retried and then succeeds', async () => {
  const delays = [];
  let calls = 0;
  const use = await loadUseM({
    sleep: recordingSleep(delays),
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        throw new TypeError('fetch failed');
      }
      return respond(BUNDLE);
    },
  });

  expect(typeof use).toBe('function');
  expect(calls).toBe(3);
  // Exponential backoff: 2000, then 4000.
  expect(delays).toEqual([2000, 4000]);
});

test('attempts are bounded and the last cause is preserved', async () => {
  const delays = [];
  let calls = 0;
  const failure = new TypeError('fetch failed');

  const error = await loadUseM({
    sleep: recordingSleep(delays),
    fetchImpl: async () => {
      calls += 1;
      throw failure;
    },
  }).then(
    () => null,
    (thrown) => thrown
  );

  expect(calls).toBe(DEFAULT_ATTEMPTS);
  expect(delays).toHaveLength(DEFAULT_ATTEMPTS - 1);
  expect(error.message).toContain(USE_M_URL);
  expect(error.message).toContain(`after ${DEFAULT_ATTEMPTS} attempt(s)`);
  expect(error.message).toContain('fetch failed');
  // The message has to say whose failure this is, so the run is re-run rather
  // than investigated as a defect in the published package.
  expect(error.message).toContain('network dependency');
  expect(error.cause).toBe(failure);
});

// eval-ing a CDN error page raises `SyntaxError: Unexpected token '<'`, which
// points at this repository's code for a response it never inspected.
test('an error page is reported by status, never evaluated', async () => {
  let calls = 0;
  const error = await loadUseM({
    attempts: 1,
    fetchImpl: async () => {
      calls += 1;
      return respond('<html><body>503 Service Unavailable</body></html>', {
        status: 503,
        statusText: 'Service Unavailable',
      });
    },
  }).then(
    () => null,
    (thrown) => thrown
  );

  expect(calls).toBe(1);
  expect(error.message).toContain('HTTP 503 Service Unavailable');
  expect(error.message).not.toContain('Unexpected token');
});

test('a bundle without a callable use names what it did export', async () => {
  const error = await loadUseM({
    attempts: 1,
    fetchImpl: async () => respond('({ notUse: 1, alsoNotUse: 2 })'),
  }).then(
    () => null,
    (thrown) => thrown
  );

  expect(error.message).toContain('notUse');
  expect(error.message).toContain('alsoNotUse');
});

test('a bundle nested under default is unwrapped', async () => {
  const use = await loadUseM({
    fetchImpl: async () =>
      respond('({ default: { use: async (name) => ({ nested: name }) } })'),
  });

  expect(await use('lino-arguments')).toEqual({ nested: 'lino-arguments' });
});

// An injected fetch must neither read nor write the process-wide cache, or one
// test would answer for the next.
test('injected fetches bypass the cache in both directions', async () => {
  resetUseMCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return respond(BUNDLE);
  };

  await loadUseM({ fetchImpl });
  await loadUseM({ fetchImpl });

  expect(calls).toBe(2);
});

test('the defaults keep a stalled CDN inside a job timeout', () => {
  expect(DEFAULT_ATTEMPTS).toBeGreaterThan(1);
  // Worst case: attempts * timeout + backoff, well under the 10-minute
  // timeout-minutes the release jobs declare.
  const worstCaseMs = DEFAULT_ATTEMPTS * DEFAULT_TIMEOUT_MS + 6000;
  expect(worstCaseMs).toBeLessThan(10 * 60 * 1000);
});

// The point of the shared loader is that the hardening applies everywhere. A
// script that fetches use.js inline gets none of it back.
test('no script fetches use-m inline any more', () => {
  const files = execFileSync('git', ['ls-files', 'js/scripts/*.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.endsWith('use-m-loader.mjs'));

  const offenders = files.filter((file) =>
    readFileSync(join(repoRoot, file), 'utf8').includes('unpkg.com/use-m')
  );

  expect(offenders).toEqual([]);
  // And the scripts that need use-m go through the loader.
  const viaLoader = files.filter((file) =>
    readFileSync(join(repoRoot, file), 'utf8').includes('loadUseM(')
  );
  expect(viaLoader.length).toBeGreaterThanOrEqual(11);
});
