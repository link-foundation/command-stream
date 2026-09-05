## Summary

`scripts/use-module.mjs`'s `loadUse()` fetches `https://unpkg.com/use-m/use.js` with a bare `fetch()` — **no deadline, no retry** — and eight release scripts call it (through `loadCommandStream()`) at **module scope**, outside their own `main()`/`try`. When the CDN is unreachable or slow, the script dies during module initialisation: it prints nothing, writes nothing to `GITHUB_OUTPUT`, and the job's only diagnostic is `TypeError: fetch failed`, which names neither the CDN nor the URL.

That turns a third-party outage into what looks like a defect in the release logic. In `link-foundation/command-stream` (which uses this template's scripts) the same shape made the publish suite fail intermittently with

```
Expected to contain: "published=true"
Received: ""
```

— two runs of the same unchanged suite differing only in whether unpkg answered.

## Where

* `scripts/use-module.mjs:113` — `const response = await fetchImpl(url);` (no `signal`, no retry)
* Module-scope callers, all of which die before their first log line:
  * `scripts/changeset-version.mjs:30`
  * `scripts/create-manual-changeset.mjs:22`
  * `scripts/instant-version-bump.mjs:36`
  * `scripts/format-github-release.mjs:23`
  * `scripts/format-release-notes.mjs:33`
  * `scripts/publish-to-npm.mjs:38`
  * `scripts/version-and-commit.mjs:31`
  * (`scripts/setup-npm.mjs:257` is inside a function, so it is the one that can report the failure itself)

Checked at `7ae16b0` (0.11.28).

## Reproduction 1 — unreachable CDN: the message names nothing

`203.0.113.0/24` is TEST-NET-3 (RFC 5737), guaranteed never routable, so it fails the way a real outage fails.

```js
// repro.mjs
import { loadUse } from './scripts/use-module.mjs';
const started = Date.now();
try {
  await loadUse({ url: 'https://203.0.113.1/use-m/use.js' });
} catch (error) {
  console.log(`elapsed ${Date.now() - started}ms`);
  console.log(`name    ${error.name}`);
  console.log(`message ${error.message}`);
  console.log(`cause   ${error.cause?.message ?? error.cause}`);
}
```

```
$ node repro.mjs
elapsed 10620ms
name    TypeError
message fetch failed
cause   Connect Timeout Error (attempted address: 203.0.113.1:443, timeout: 10000ms)
```

The 10 s bound comes from undici's connect timeout, not from this code, and the `cause` is only visible because the reproduction prints it — a script that dies at module scope shows `TypeError: fetch failed` and a stack inside `use-module.mjs`.

## Reproduction 2 — stalled CDN: nothing bounds the wait

A connect timeout does not cover a server that accepts the connection and then never answers. undici's `headersTimeout` default is 300 s, so one such fetch can burn five minutes of a job's `timeout-minutes`:

```js
// stall.mjs
import { createServer } from 'node:http';
import { loadUse } from './scripts/use-module.mjs';

const server = createServer(() => {});             // accepts, never responds
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/use-m/use.js`;

const started = Date.now();
const outcome = await Promise.race([
  loadUse({ url }).then(() => 'resolved', (e) => `rejected: ${e.message}`),
  new Promise((r) => setTimeout(() => r('still waiting'), 25000)),
]);
console.log(`after ${Date.now() - started}ms: ${outcome}`);
process.exit(0);
```

```
$ node stall.mjs
after 25047ms: still waiting
```

## Workaround

Re-run the job — the failure is transient — and, in test suites that spawn these scripts, probe `https://unpkg.com/use-m/use.js` (not only `npm view`) before asserting: npm's registry and unpkg are different services that fail independently, so a reachable registry does not mean the dependency the script needs at startup is reachable.

## Suggested fix

Give the load a deadline and a bounded retry, and make the final error say what failed. `AbortSignal.timeout()` is available on every runtime these scripts target (Node 18+, Bun):

```diff
+/** Per-attempt deadline: a stalled connect must not consume the job's budget. */
+export const DEFAULT_TIMEOUT_MS = 15000;
+/** Total attempts, including the first one. */
+export const DEFAULT_ATTEMPTS = 3;
+/** Delay before the second attempt; doubled for each attempt after it. */
+export const DEFAULT_RETRY_DELAY_MS = 2000;
+
 export async function loadUse(options = {}) {
-  const { fetchImpl = fetch, url = USE_M_URL } = options;
+  const {
+    fetchImpl = fetch,
+    url = USE_M_URL,
+    attempts = DEFAULT_ATTEMPTS,
+    timeoutMs = DEFAULT_TIMEOUT_MS,
+    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
+    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
+  } = options;
   if (cachedUse && !options.fetchImpl) {
     return cachedUse;
   }
-  const response = await fetchImpl(url);
-  ...
+  let lastError;
+  for (let attempt = 1; attempt <= attempts; attempt += 1) {
+    try {
+      const use = await fetchOnce({ fetchImpl, url, timeoutMs }); // signal: AbortSignal.timeout(timeoutMs)
+      debug('loaded use-m', { url, attempt });
+      if (!options.fetchImpl) cachedUse = use;
+      return use;
+    } catch (error) {
+      lastError = error;
+      debug('use-m load attempt failed', { url, attempt, attempts, error: error?.message });
+      if (attempt < attempts) await sleep(retryDelayMs * 2 ** (attempt - 1));
+    }
+  }
+  throw new Error(
+    `Failed to load use-m from ${url} after ${attempts} attempt(s): ` +
+      `${lastError?.message ?? String(lastError)}. This is a network dependency ` +
+      'of the release scripts, not a defect in the published package; re-run ' +
+      'the job when the CDN answers again.',
+    { cause: lastError }
+  );
 }
```

With that in place the same reproduction reports:

```
Error: Failed to load use-m from https://203.0.113.1/use-m/use.js after 2 attempt(s): The operation was aborted due to timeout. This is a network dependency of the release scripts, not a defect in the published package; re-run the job when the CDN answers again.
```

Two follow-ups worth doing in the same change:

1. **Move the module-scope `await loadCommandStream()` calls inside `main()`** (as `setup-npm.mjs` already does), so a load failure is caught by the script's own error handling and the script can still write `published=false` / an explanatory line to `GITHUB_OUTPUT` instead of dying silently.
2. Keep the retry bounded so the worst case stays well inside the job's `timeout-minutes` (3 × 15 s + backoff ≈ 51 s).

## Reference implementation

`link-foundation/command-stream` ships this as [`js/scripts/use-m-loader.mjs`](https://github.com/link-foundation/command-stream/blob/issue-199-32c07917fc87/js/scripts/use-m-loader.mjs), with unit tests in [`js/tests/use-m-loader.test.mjs`](https://github.com/link-foundation/command-stream/blob/issue-199-32c07917fc87/js/tests/use-m-loader.test.mjs) (deadline present on every attempt, retry-then-succeed, bounded attempts, error page reported by status instead of eval-ed, cause preserved) and a runnable before/after reproduction in [`experiments/publish-cdn-unreachable.mjs`](https://github.com/link-foundation/command-stream/blob/issue-199-32c07917fc87/experiments/publish-cdn-unreachable.mjs). Found while working on link-foundation/command-stream#199.
