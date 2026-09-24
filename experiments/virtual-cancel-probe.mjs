// Does kill() reach a running virtual command handler?
import { $, register, unregister } from '../js/src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const events = [];

register('cancellable', async ({ abortSignal, isCancelled }) => {
  events.push([
    'handler start',
    { hasSignal: !!abortSignal, aborted: abortSignal?.aborted },
  ]);
  abortSignal?.addEventListener?.('abort', () =>
    events.push(['abort event', true])
  );
  for (let i = 0; i < 20; i++) {
    if (abortSignal?.aborted) {
      events.push(['saw aborted at', i]);
      break;
    }
    if (isCancelled?.()) {
      events.push(['saw isCancelled at', i]);
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  events.push(['handler end', null]);
  return { stdout: '', code: 0 };
});

const runner = $({ mirror: false })`cancellable`;
runner.start();
setTimeout(() => {
  events.push(['kill called', null]);
  runner.kill();
}, 50);
const result = await runner;
events.push(['result code', result.code]);
console.log(`[${runtime}]`, JSON.stringify(events));
unregister('cancellable');
