import { CdnProbeError } from './deno-cdn-retry.mjs';

// The checkout HTTP probe must pass before this hosted-only probe is called.
// A public CDN's full disk cannot be repaired by a pull request. Confirm that
// exact outage independently; never suppress a compiler or execution failure.
export async function probeHostedCdn(
  url,
  { probe, eventName, fetch: request = fetch, log = console.log }
) {
  try {
    await probe(url);
    return;
  } catch (error) {
    const diagnostic =
      error instanceof CdnProbeError
        ? error.stderr.replace(/\u001b\[[\d;]*m/g, '')
        : '';
    const failedUrl = diagnostic.match(
      /TypeError: Import '([^']+)' failed: 500 Internal Server Error/
    )?.[1];
    if (failedUrl !== url || !url.startsWith('https://esm.sh/gh/')) {
      throw error;
    }

    let storageOutage = false;
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(15000),
      });
      storageOutage =
        response.status === 500 &&
        /^mkdir \/esm\/npm\/\.install-\d+: no space left on device$/.test(
          (await response.text()).trim()
        );
    } catch {
      // A failed diagnostic request is not proof of the storage outage.
    }
    if (!storageOutage) {
      throw error;
    }

    const recovery =
      'Ask the esm.sh operator to free storage under /esm/npm, then rerun the Deno CDN job.';
    if (eventName !== 'pull_request') {
      throw new Error(
        `esm.sh GitHub compilation is out of disk space. ${recovery}`,
        {
          cause: error,
        }
      );
    }
    const reason = [
      'Skipping only esm.sh GitHub compilation: confirmed upstream storage outage (no space left on device).',
      'The checkout HTTP probe with real esm.sh dependencies already passed.',
      recovery,
    ].join(' ');
    log(`::warning::${reason}`);
  }
}
