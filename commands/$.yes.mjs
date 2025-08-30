import { trace } from '../$.utils.mjs';

export default async function* yes({ args, stdin, isCancelled, signal, ...rest }) {
  const output = args.length > 0 ? args.join(' ') : 'y';
  trace('VirtualCommand', () => `yes: starting infinite generator | ${JSON.stringify({ output }, null, 2)}`);

  let iteration = 0;
  const MAX_ITERATIONS = 1000000; // Safety limit

  while (!isCancelled?.() && iteration < MAX_ITERATIONS) {
    // Check for abort signal
    if (signal?.aborted) {
      trace('VirtualCommand', () => `yes: aborted via signal | ${JSON.stringify({ iteration }, null, 2)}`);
      break;
    }

    // Also check rest properties for various cancellation methods
    if (rest.aborted || rest.cancelled || rest.stop) {
      trace('VirtualCommand', () => `yes: stopped via property | ${JSON.stringify({ iteration }, null, 2)}`);
      break;
    }

    yield output + '\n';

    iteration++;

    // Yield control periodically to prevent blocking
    if (iteration % 1000 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  trace('VirtualCommand', () => `yes: generator completed | ${JSON.stringify({ iteration }, null, 2)}`);
}