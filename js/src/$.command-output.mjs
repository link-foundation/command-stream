import { effectiveCwd, effectiveEnv } from './$.process-context.mjs';
import { safeWrite } from './$.stream-utils.mjs';
export function isCommandIterable(value) {
  return Boolean(value?.[Symbol.asyncIterator] || value?.[Symbol.iterator]);
}

export function commandIterator(value) {
  return value[Symbol.asyncIterator]
    ? value[Symbol.asyncIterator]()
    : value[Symbol.iterator]();
}

/** Pull-driven virtual pipeline stage, bounded by the Web Stream queue. */
export function createGeneratorStage(output, runner, last) {
  const iterator = commandIterator(output);
  const chunks = [];
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (item.done || runner._cancelled) {
          controller.close();
          resolveDone(0);
          return;
        }
        const data = Buffer.from(item.value);
        controller.enqueue(data);
        if (last) {
          if (runner.options.capture) {
            chunks.push(data);
          }
          if (runner.options.mirror) {
            safeWrite(process.stdout, data);
          }
          runner._emitProcessedData('stdout', data);
          await runner._waitForStreamCapacity();
        }
      } catch (error) {
        controller.error(error);
        rejectDone(error);
      }
    },
    async cancel() {
      resolveDone(0);
      await iterator.return?.();
    },
  });
  return { stream, done, output: () => Buffer.concat(chunks).toString('utf8') };
}

export function virtualContext(runner, args, stdin) {
  return {
    args,
    stdin,
    options: runner.options,
    cwd: effectiveCwd(runner),
    env: effectiveEnv(runner) ?? process.env,
    abortSignal: runner._abortController?.signal,
    isCancelled: () => runner._cancelled,
  };
}
