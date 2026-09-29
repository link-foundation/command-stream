// Low-level process launcher behind the zx-compatible `$` (issue #26).
//
// `exec(ctx)` spawns the command (sync or async), buffers every chunk into a
// shared store (`stdout`, `stderr` and the interleaved `stdall`) and reports
// the lifecycle through `ctx.ee`: start, stdout, stderr, stdall, err, abort
// and end. The zx layer subscribes via `ctx.on` and turns the final `end`
// payload into a ProcessOutput.

import cp from 'node:child_process';
import EventEmitter from 'node:events';
import process from 'node:process';
import { Readable, Transform } from 'node:stream';

// Pass-through stream that also re-emits every chunk as a `data` event, so it
// can be written to before anybody reads from it.
export class VoidStream extends Transform {
  _transform(chunk, _encoding, cb) {
    this.emit('data', chunk);
    cb();
  }
}

export const createStore = () => ({ stdout: [], stderr: [], stdall: [] });

const immediate = (cb) => cb();

const defaultCtx = () => ({
  cmd: '',
  cwd: process.cwd(),
  sync: false,
  args: [],
  input: null,
  env: process.env,
  ee: new EventEmitter(),
  on: {},
  detached: process.platform !== 'win32',
  shell: true,
  spawn: cp.spawn,
  spawnSync: cp.spawnSync,
  spawnOpts: {},
  store: createStore(),
  stdin: new VoidStream(),
  stdout: new VoidStream(),
  stderr: new VoidStream(),
  stdio: ['pipe', 'pipe', 'pipe'],
  run: immediate,
});

const spawnOptions = (c) => ({
  ...c.spawnOpts,
  env: c.env,
  cwd: c.cwd,
  stdio: c.stdio,
  shell: c.shell,
  input: c.input,
  windowsHide: true,
  detached: c.detached,
  signal: c.signal,
});

function toggleListeners(ee, on) {
  for (const [name, listener] of Object.entries(on)) {
    ee.on(name, listener);
  }
  ee.once('end', () => {
    for (const [name, listener] of Object.entries(on)) {
      ee.off(name, listener);
    }
  });
}

function feedInput(child, input) {
  if (!input || !child.stdin || child.stdin.destroyed) {
    return;
  }
  if (input instanceof Readable) {
    input.pipe(child.stdin);
    return;
  }
  child.stdin.write(input);
  child.stdin.end();
}

function settle(c, fields, startedAt) {
  const { store } = c;
  c.fulfilled = {
    ...fields,
    get stdout() {
      return store.stdout.join('');
    },
    get stderr() {
      return store.stderr.join('');
    },
    get stdall() {
      return store.stdall.join('');
    },
    stdio: [c.stdin, c.stdout, c.stderr],
    duration: Date.now() - startedAt,
    ctx: c,
  };
  return c.fulfilled;
}

function makePush(c) {
  return (kind, data) => {
    c.store[kind].push(data);
    c.store.stdall.push(data);
    c.ee.emit(kind, data, c);
    c.ee.emit('stdall', data, c);
  };
}

function runSync(c, startedAt) {
  const push = makePush(c);
  toggleListeners(c.ee, c.on);
  const result = c.spawnSync(c.cmd, c.args, spawnOptions(c));
  c.ee.emit('start', result, c);
  if (result.stdout?.length > 0) {
    c.stdout.write(result.stdout);
    push('stdout', result.stdout);
  }
  if (result.stderr?.length > 0) {
    c.stderr.write(result.stderr);
    push('stderr', result.stderr);
  }
  settle(c, { ...result, error: result.error ?? null }, startedAt);
  c.ee.emit('end', c.fulfilled, c);
}

function wireChild(c, child, opts, startedAt) {
  const push = makePush(c);
  let error = null;
  let aborted = false;
  const onAbort = (event) => {
    if (opts.detached && child.pid) {
      try {
        process.kill(-child.pid);
      } catch (_err) {
        child.kill();
      }
    }
    aborted = true;
    c.ee.emit('abort', event, c);
  };
  opts.signal?.addEventListener('abort', onAbort);
  feedInput(child, c.input || c.stdin);
  child.stdout?.on('data', (d) => push('stdout', d)).pipe(c.stdout);
  child.stderr?.on('data', (d) => push('stderr', d)).pipe(c.stderr);
  child
    .once('error', (err) => {
      error = err;
      c.ee.emit('err', err, c);
    })
    .once('exit', () => {
      if (aborted) {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    })
    .once('close', (status, signal) => {
      opts.signal?.removeEventListener('abort', onAbort);
      settle(c, { error, status, signal }, startedAt);
      c.ee.emit('end', c.fulfilled, c);
    });
}

function runAsync(c, startedAt) {
  c.run(() => {
    toggleListeners(c.ee, c.on);
    const opts = spawnOptions(c);
    const child = c.spawn(c.cmd, c.args, opts);
    c.child = child;
    c.ee.emit('start', child, c);
    wireChild(c, child, opts, startedAt);
  }, c);
}

/**
 * Spawn a command described by `ctx` and stream its lifecycle to `ctx.ee`.
 *
 * @param {object} ctx Partial context (see `defaultCtx`).
 * @returns {object} The normalized, live context.
 */
export function exec(ctx) {
  const overrides = Object.entries(ctx).filter(([, v]) => v !== undefined);
  const c = Object.assign(defaultCtx(), Object.fromEntries(overrides));
  if (!c.signal) {
    c.ac = c.ac || new AbortController();
    c.signal = c.ac.signal;
  }
  const startedAt = Date.now();
  try {
    if (c.sync) {
      runSync(c, startedAt);
    } else {
      runAsync(c, startedAt);
    }
  } catch (error) {
    // A settled context means the error came from an `end` listener (for
    // example a failed sync command); let it propagate to the caller.
    if (c.fulfilled) {
      throw error;
    }
    settle(c, { error, status: null, signal: null }, startedAt);
    c.ee.emit('err', error, c);
    c.ee.emit('end', c.fulfilled, c);
  }
  return c;
}
