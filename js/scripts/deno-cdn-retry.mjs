import { setTimeout as sleep } from 'node:timers/promises';

export class CdnProbeError extends Error {
  constructor(code, stderr) {
    super(`Deno CDN smoke test exited with ${code}`);
    this.stderr = stderr;
  }
}

// esm.sh returns HTTP 408 while a cold module is waiting in its build queue.
// Retry only that import failure; compilation and execution failures stay fatal.
export async function retryCdnProbe(
  probe,
  { sleep: wait = sleep, log = console.log } = {}
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await probe();
    } catch (error) {
      const diagnostic =
        error instanceof CdnProbeError
          ? error.stderr.replace(/\u001b\[[\d;]*m/g, '')
          : '';
      const queuedUrl = diagnostic.match(
        /TypeError: Import '(https:\/\/esm\.sh\/[^']+)' failed: 408 Request Timeout/
      )?.[1];
      if (!queuedUrl || attempt === 3) {
        throw error;
      }
      const delayMs = 5000 * attempt;
      log(
        `esm.sh build queue timed out for ${queuedUrl}; ` +
          `retrying the Deno probe in ${delayMs} ms (attempt ${attempt + 1}/3).`
      );
      await wait(delayMs);
    }
  }
}
