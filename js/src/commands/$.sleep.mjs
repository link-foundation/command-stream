import { trace } from '../$.utils.mjs';

export default async function sleep({ args, abortSignal, isCancelled }) {
  const seconds = parseFloat(args[0] || 0);
  trace(
    'VirtualCommand',
    () =>
      `sleep: starting | ${JSON.stringify(
        {
          seconds,
          hasSignal: !!abortSignal,
          signalAborted: abortSignal?.aborted,
          hasIsCancelled: !!isCancelled,
        },
        null,
        2
      )}`
  );

  if (isNaN(seconds) || seconds < 0) {
    return { stderr: `sleep: invalid time interval '${args[0]}'`, code: 1 };
  }

  // Use abort signal if available, otherwise use setTimeout
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      let checkInterval;

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (checkInterval) {
          clearInterval(checkInterval);
        }
        abortSignal?.removeEventListener('abort', handleAbort);
      };

      const settle = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback(value);
      };

      const complete = () => settle(resolve);
      const cancel = () => settle(reject, new Error('Sleep cancelled'));
      const handleAbort = () => {
        trace(
          'VirtualCommand',
          () =>
            `sleep: abort signal received | ${JSON.stringify(
              {
                seconds,
                signalAborted: abortSignal.aborted,
              },
              null,
              2
            )}`
        );
        cancel();
      };

      const timeoutId = setTimeout(complete, seconds * 1000);

      // Handle cancellation via abort signal
      if (abortSignal) {
        trace(
          'VirtualCommand',
          () =>
            `sleep: setting up abort signal listener | ${JSON.stringify(
              {
                signalAborted: abortSignal.aborted,
              },
              null,
              2
            )}`
        );

        abortSignal.addEventListener('abort', handleAbort, { once: true });

        // Check if already aborted
        if (abortSignal.aborted) {
          trace(
            'VirtualCommand',
            () =>
              `sleep: signal already aborted | ${JSON.stringify({ seconds }, null, 2)}`
          );
          cancel();
          return;
        }
      } else {
        trace(
          'VirtualCommand',
          () =>
            `sleep: no abort signal provided | ${JSON.stringify({ seconds }, null, 2)}`
        );
      }

      // Also check isCancelled periodically for quicker response
      if (isCancelled) {
        trace(
          'VirtualCommand',
          () =>
            `sleep: setting up isCancelled polling | ${JSON.stringify({ seconds }, null, 2)}`
        );
        checkInterval = setInterval(() => {
          if (isCancelled()) {
            trace(
              'VirtualCommand',
              () =>
                `sleep: isCancelled returned true | ${JSON.stringify({ seconds }, null, 2)}`
            );
            cancel();
          }
        }, 100);
        checkInterval.unref?.();
      }
    });

    trace(
      'VirtualCommand',
      () =>
        `sleep: completed naturally | ${JSON.stringify({ seconds }, null, 2)}`
    );
    return { stdout: '', code: 0 };
  } catch (err) {
    trace(
      'VirtualCommand',
      () =>
        `sleep: interrupted | ${JSON.stringify(
          {
            seconds,
            error: err.message,
            errorName: err.name,
          },
          null,
          2
        )}`
    );
    // Let the ProcessRunner determine the appropriate exit code based on the cancellation signal
    throw err;
  }
}
