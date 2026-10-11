// Running commands can be killed, and virtual commands are told about it
// through abortSignal / isCancelled().
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'cancellation', title: 'Killing and cancelling commands' },
  async ({ record }) => {
    const runner = $q`${process.execPath} -e ${'setTimeout(() => {}, 30_000)'}`;
    const childAvailableImmediately =
      typeof runner.child?.kill === 'function' && runner.started;
    runner.child.kill('SIGTERM');
    const killed = await runner;
    record('child handle available immediately', childAvailableImmediately);
    record('exit code after child.kill()', killed.code);

    // The handler reports back as soon as it notices the cancellation, so the
    // example does not depend on timing.
    let noticed;
    const noticedCancellation = new Promise((resolve) => {
      noticed = resolve;
    });

    register('cancellable', async ({ abortSignal, isCancelled }) => {
      for (let i = 0; i < 200; i++) {
        if (abortSignal?.aborted || isCancelled()) {
          noticed({
            aborted: abortSignal?.aborted === true,
            cancelled: isCancelled(),
          });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { stdout: '', code: 0 };
    });

    const virtualRunner = $q`cancellable`;
    virtualRunner.start();
    setTimeout(() => virtualRunner.kill(), 50);
    await virtualRunner;
    record('what the virtual command observed', await noticedCancellation);
    unregister('cancellable');
  }
);
