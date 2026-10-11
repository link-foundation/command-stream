import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';

const positive = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('Size must be a positive integer');
  }
  return value;
};

/** Single-consumer, pull-driven stream. Operators never collect their source. */
export class StreamPipeline {
  constructor(factory, commandOutput = false, onReturn) {
    this.factory = factory;
    this.commandOutput = commandOutput;
    this.iterator = null;
    this.onReturn = onReturn;
  }
  [Symbol.asyncIterator]() {
    return this;
  }
  next(...args) {
    this.iterator ??= this.factory()[Symbol.asyncIterator]();
    return this.iterator.next(...args);
  }
  return(value) {
    this.iterator ??= this.factory()[Symbol.asyncIterator]();
    // Propagate cancellation before awaiting an iterator's queued return().
    // Otherwise a pending read from an idle process can block cancellation.
    const cancelled = this.onReturn?.(value);
    const returned =
      this.iterator.return?.(value) ?? Promise.resolve({ done: true, value });
    return Promise.all([cancelled, returned]).then(([, result]) => result);
  }
  throw(error) {
    this.iterator ??= this.factory()[Symbol.asyncIterator]();
    return this.iterator.throw?.(error) ?? Promise.reject(error);
  }
  values() {
    return this.commandOutput ? this.lines() : this;
  }

  map(fn) {
    const source = this.values();
    return derived(
      source,
      (async function* () {
        let index = 0;
        for await (const value of source) {
          yield await fn(value, index++);
        }
      })()
    );
  }
  filter(fn) {
    const source = this.values();
    return derived(
      source,
      (async function* () {
        let index = 0;
        for await (const value of source) {
          if (await fn(value, index++)) {
            yield value;
          }
        }
      })()
    );
  }
  async reduce(fn, initial) {
    let value = initial;
    let index = 0;
    for await (const item of this.values()) {
      value = await fn(value, item, index++);
    }
    return value;
  }
  async forEach(fn) {
    let index = 0;
    for await (const value of this.values()) {
      await fn(value, index++);
    }
  }
  async toArray() {
    const values = [];
    for await (const value of this) {
      values.push(value);
    }
    return values;
  }

  batch(size) {
    positive(size);
    const source = this.values();
    return derived(
      source,
      (async function* () {
        let batch = [];
        for await (const value of source) {
          batch.push(value);
          if (batch.length === size) {
            yield batch;
            batch = [];
          }
        }
        if (batch.length) {
          yield batch;
        }
      })()
    );
  }
  window(size, step = 1) {
    positive(size);
    positive(step);
    const source = this.values();
    return derived(
      source,
      (async function* () {
        const values = [];
        let index = 0;
        for await (const value of source) {
          values.push(value);
          if (values.length > size) {
            values.shift();
          }
          if (values.length === size && (index - size + 1) % step === 0) {
            yield [...values];
          }
          index++;
        }
      })()
    );
  }
  take(count) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError('Count must be a nonnegative integer');
    }
    const source = this;
    return derived(
      source,
      (async function* () {
        if (count === 0) {
          await source.return();
          return;
        }
        let index = 0;
        for await (const item of source) {
          yield item;
          if (++index === count) {
            break;
          }
        }
      })()
    );
  }
  lines({ stderr = false } = {}) {
    const source = this;
    return derived(
      source,
      (async function* () {
        const decoder = new StringDecoder('utf8');
        let pending = '';
        for await (const chunk of source) {
          if (chunk?.type === 'exit' || (chunk?.type === 'stderr' && !stderr)) {
            continue;
          }
          const data = chunk?.data ?? chunk;
          pending +=
            typeof data === 'string' ? data : decoder.write(Buffer.from(data));
          let end;
          while ((end = pending.indexOf('\n')) !== -1) {
            yield pending.slice(0, end).replace(/\r$/, '');
            pending = pending.slice(end + 1);
          }
        }
        pending += decoder.end();
        if (pending) {
          yield pending;
        }
      })()
    );
  }
  split(predicate, { highWaterMark = 32 } = {}) {
    positive(highWaterMark);
    const source = this.values();
    const queues = [
      new BoundedQueue(highWaterMark),
      new BoundedQueue(highWaterMark),
    ];
    let started = false;
    const start = () => {
      if (started) {
        return;
      }
      started = true;
      (async () => {
        try {
          for await (const value of source) {
            if (queues.every((q) => q.closed)) {
              break;
            }
            await queues[(await predicate(value)) ? 0 : 1].put(value);
          }
          queues.forEach((q) => q.close());
        } catch (error) {
          queues.forEach((q) => q.close(error));
        }
      })();
    };
    return queues.map((queue) => {
      const branch = stream(
        (async function* () {
          start();
          try {
            while (true) {
              const item = await queue.next();
              if (item.done) {
                break;
              }
              yield item.value;
            }
          } finally {
            queue.close();
          }
        })()
      );
      const finish = branch.return.bind(branch);
      branch.return = (value) => {
        queue.close();
        const cancelled = queues.every((q) => q.closed)
          ? source.return()
          : undefined;
        return Promise.all([cancelled, finish(value)]).then(
          ([, result]) => result
        );
      };
      return branch;
    });
  }
  async analyze({
    errorRate,
    responseTime,
    throughput = true,
    onUpdate,
    now = () => performance.now(),
  } = {}) {
    const start = now();
    let count = 0;
    let errors = 0;
    let samples = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const snapshot = () => ({
      count,
      errors,
      errorRate: count ? errors / count : 0,
      elapsed: Math.max(0, now() - start),
      throughput: throughput
        ? count / Math.max((now() - start) / 1000, 0.001)
        : undefined,
      responseTime: {
        count: samples,
        mean: samples ? sum / samples : 0,
        min: samples ? min : 0,
        max: samples ? max : 0,
      },
    });
    for await (const value of this.values()) {
      count++;
      if (errorRate && (await errorRate(value))) {
        errors++;
      }
      if (responseTime) {
        const time = await responseTime(value);
        if (Number.isFinite(time)) {
          samples++;
          sum += time;
          min = Math.min(min, time);
          max = Math.max(max, time);
        }
      }
      if (onUpdate) {
        await onUpdate(snapshot());
      }
    }
    return snapshot();
  }
}

export function stream(source) {
  if (!source || (!source[Symbol.asyncIterator] && !source[Symbol.iterator])) {
    throw new TypeError('Expected an iterable stream');
  }
  if (source instanceof StreamPipeline) {
    return source;
  }
  if (source[Symbol.asyncIterator]) {
    return new StreamPipeline(() => source);
  }
  return new StreamPipeline(() =>
    (async function* () {
      yield* source;
    })()
  );
}

function derived(source, iterator) {
  return new StreamPipeline(
    () => iterator,
    false,
    () => source.return()
  );
}

class BoundedQueue {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = [];
    this.closed = false;
    this.waiters = [];
  }
  wake() {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
  wait() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  async put(value) {
    while (!this.closed && this.items.length >= this.capacity) {
      await this.wait();
    }
    if (!this.closed) {
      this.items.push(value);
      this.wake();
    }
  }
  close(error) {
    this.closed = true;
    this.error = error;
    this.wake();
  }
  async next() {
    while (!this.closed && !this.items.length) {
      await this.wait();
    }
    if (this.error) {
      throw this.error;
    }
    const done = !this.items.length;
    const value = this.items.shift();
    this.wake();
    return { done, value };
  }
}

/** One pending read per input; values arrive in readiness order. */
export function merge(...sources) {
  const iterators = sources.map((source) => stream(source));
  const cancel = () =>
    Promise.allSettled(iterators.map((iterator) => iterator.return()));
  return new StreamPipeline(
    () =>
      (async function* () {
        const pending = new Map();
        const read = (index) =>
          pending.set(
            index,
            iterators[index].next().then((item) => ({ index, item }))
          );
        iterators.forEach((_, index) => read(index));
        try {
          while (pending.size) {
            const { index, item } = await Promise.race(pending.values());
            pending.delete(index);
            if (!item.done) {
              yield item.value;
              read(index);
            }
          }
        } finally {
          await cancel();
        }
      })(),
    false,
    cancel
  );
}
