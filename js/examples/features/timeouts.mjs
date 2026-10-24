// The timeout option stops a command that runs too long.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'timeouts', title: 'Time out a command' },
  async ({ record }) => {
    // Stopped with the kill signal (SIGTERM) once 200ms have passed.
    const slow = await $({ mirror: false, timeout: 200 })`sleep 5`;
    record('exit code', slow.code);
    record('timed out', slow.timedOut);

    const quick = await $({ mirror: false, timeout: 5000 })`echo in time`;
    record('finished in time', quick.stdout);
    record('quick command timed out', quick.timedOut);
  }
);
