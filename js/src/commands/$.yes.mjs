import { trace } from '../$.utils.mjs';

export default async function* yes({
  args,
  stdin: _stdin,
  isCancelled,
  abortSignal,
  ...rest
}) {
  const output = args.length > 0 ? args.join(' ') : 'y';
  trace(
    'VirtualCommand',
    () =>
      `yes: starting infinite generator | ${JSON.stringify(
        {
          output,
          hasIsCancelled: !!isCancelled,
          hasAbortSignal: !!abortSignal,
        },
        null,
        2
      )}`
  );

  let iteration = 0;
  const MAX_ITERATIONS = 1000000; // Safety limit

  while (!isCancelled?.() && iteration < MAX_ITERATIONS) {
    trace(
      'VirtualCommand',
      () =>
        `yes: iteration ${iteration} starting | ${JSON.stringify(
          {
            isCancelled: isCancelled?.(),
            abortSignalAborted: abortSignal?.aborted,
          },
          null,
          2
        )}`
    );

    // Check for abort signal
    if (abortSignal?.aborted) {
      trace(
        'VirtualCommand',
        () =>
          `yes: aborted via abort signal | ${JSON.stringify({ iteration }, null, 2)}`
      );
      break;
    }

    // Also check rest properties for various cancellation methods
    if (rest.aborted || rest.cancelled || rest.stop) {
      trace(
        'VirtualCommand',
        () =>
          `yes: stopped via property | ${JSON.stringify({ iteration }, null, 2)}`
      );
      break;
    }

    trace(
      'VirtualCommand',
      () => `yes: yielding output for iteration ${iteration}`
    );
    yield `${output}\n`;

    iteration++;

    // Yield control after every iteration to allow cancellation
    // This ensures the consumer can break cleanly
    trace(
      'VirtualCommand',
      () => `yes: yielding control after iteration ${iteration - 1}`
    );
    await new Promise((resolve) => setImmediate(resolve));
  }

  trace(
    'VirtualCommand',
    () =>
      `yes: generator completed | ${JSON.stringify(
        {
          iteration,
          wasCancelled: isCancelled?.(),
          wasAborted: abortSignal?.aborted,
        },
        null,
        2
      )}`
  );
}
