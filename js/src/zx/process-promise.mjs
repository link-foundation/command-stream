// zx-compatible ProcessPromise: a lazily configurable, pipeable promise of a
// ProcessOutput (issue #26).

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { EOL as OS_EOL } from 'node:os';
import { Fail } from './error.mjs';
import { DLMTR, ProcessOutput } from './process-output.mjs';
import { VoidStream, exec } from './spawn.mjs';
import {
  buildCmd,
  getLast,
  getLines,
  isString,
  isStringLiteral,
  noop,
  parseDuration,
  preferLocalBin,
  proxyOverride,
  randomId,
} from './util.mjs';
import { $ } from './core.mjs';

export const CWD = Symbol('processCwd');
export const SYNC = Symbol('syncExec');
export const SHOT = Symbol('snapshot');
const EPF = Symbol('end-piped-from');
const EOL = Buffer.from(OS_EOL);
const BR_CC = '\n'.charCodeAt(0);

// Tracks pipe relations between processes and writable destinations.
const bus = {
  refs: new Map(),
  streams: new WeakMap(),
  pipe(from, to) {
    if (!this.refs.has(from)) {
      this.refs.set(from, new Set());
    }
    this.refs.get(from).add(to);
  },
  unpipe(from, to) {
    const set = this.refs.get(from);
    if (!set) {
      return;
    }
    if (to) {
      set.delete(to);
    }
    if (set.size) {
      return;
    }
    this.refs.delete(from);
    from._piped = false;
  },
  unpipeBack(to) {
    for (const from of this.refs.keys()) {
      this.unpipe(from, to);
    }
  },
  runBack(p) {
    for (const from of this.sources(p)) {
      if (from instanceof ProcessPromise) {
        from.run();
      } else {
        this.streams.get(from)?.run();
      }
    }
  },
  sources(p) {
    const refs = [];
    for (const [from, set] of this.refs.entries()) {
      if (set.has(p)) {
        refs.push(from);
      }
    }
    return refs;
  },
};

// Wrap a writable destination so that it is also awaitable (resolving with
// the source output merged into the stream) and chainable via `.pipe()`.
function promisifyStream(stream, from) {
  const existing = bus.streams.get(stream);
  if (existing) {
    return existing;
  }
  const proxy = proxyOverride(stream, {
    then(res = noop, rej = noop) {
      return new Promise((resolve, reject) => {
        const end = () => resolve(res(proxyOverride(stream, from.output)));
        stream
          .once('error', (e) => reject(rej(e)))
          .once('finish', end)
          .once(EPF, end);
      });
    },
    run() {
      from.run();
    },
    pipe(...args) {
      const dest = stream.pipe(...args);
      return dest instanceof ProcessPromise
        ? dest
        : promisifyStream(dest, from);
    },
  });
  bus.streams.set(stream, proxy);
  return proxy;
}

export class ProcessPromise extends Promise {
  _stage = 'initial';
  _id = randomId();
  _snapshot = undefined;
  _timeoutId = undefined;
  _piped = false;
  _stdin = new VoidStream();
  _zurk = null;
  _output = null;
  _breakerData = undefined;
  writable = true;

  constructor(executor) {
    let resolve;
    let reject;
    super((...args) => {
      [resolve = noop, reject = noop] = args;
      executor(...args);
    });
    const snapshot = executor[SHOT];
    if (!snapshot) {
      ProcessPromise.disarm(this);
      return;
    }
    this._snapshot = snapshot;
    this._resolve = resolve;
    this._reject = reject;
    if (snapshot.halt) {
      this._stage = 'halted';
    }
    try {
      this.build();
    } catch (err) {
      this.finalize(ProcessOutput.fromError(err), true);
    }
  }

  build() {
    const snap = this._snapshot;
    if (!snap.shell) {
      throw new Fail(`No shell is available: ${Fail.DOCS_URL}/shell`);
    }
    if (!snap.quote) {
      throw new Fail(`No quote function is defined: ${Fail.DOCS_URL}/quotes`);
    }
    if (snap.pieces.some((p) => p === null || p === undefined)) {
      throw new Fail(`Malformed command at ${snap.from}`);
    }
    snap.cmd = buildCmd(snap.quote, snap.pieces, snap.args);
    if (snap[SYNC] && !isString(snap.cmd)) {
      throw new Fail('sync mode does not allow async command resolution');
    }
  }

  run() {
    bus.runBack(this);
    if (this.isRunning() || this.isSettled()) {
      return this;
    }
    this._stage = 'running';
    const snap = this._snapshot;
    const { cwd } = this;
    if (!fs.existsSync(cwd)) {
      const error = new Error(`The working directory '${cwd}' does not exist.`);
      this.finalize(ProcessOutput.fromError(error));
      return this;
    }
    if (snap.preferLocal) {
      const dirs =
        snap.preferLocal === true
          ? [snap.cwd, snap[CWD]]
          : [snap.preferLocal].flat();
      snap.env = preferLocalBin(snap.env, ...dirs);
    }
    this._zurk = exec(this.execOptions());
    return this;
  }

  execOptions() {
    const snap = this._snapshot;
    return {
      cmd: this.fullCmd,
      cwd: this.cwd,
      input: snap.input?.stdout ?? snap.input,
      stdin: this._stdin,
      sync: this.sync,
      signal: this.signal,
      shell: isString(snap.shell) ? snap.shell : true,
      id: this.id,
      env: snap.env,
      spawn: snap.spawn,
      spawnSync: snap.spawnSync,
      store: snap.store,
      stdio: snap.stdio,
      detached: snap.detached,
      ee: snap.ee,
      run: (cb, ctx) => this.resolveCmd(cb, ctx),
      on: this.lifecycleHandlers(),
    };
  }

  async resolveCmd(cb, ctx) {
    try {
      if (!isString(this.cmd)) {
        this._snapshot.cmd = await this.cmd;
        ctx.cmd = this.fullCmd;
      }
      cb();
    } catch (error) {
      this.finalize(ProcessOutput.fromError(error));
    }
  }

  lifecycleHandlers() {
    const snap = this._snapshot;
    const id = this.id;
    return {
      start: () => {
        const verbose = this.isVerbose();
        snap.log({ kind: 'cmd', cmd: snap.cmd, cwd: this.cwd, verbose, id });
        this.timeout(snap.timeout, snap.timeoutSignal);
      },
      // Piped output is not echoed; stderr is echoed unless quiet.
      stdout: (data) => {
        const verbose = !this._piped && this.isVerbose();
        snap.log({ kind: 'stdout', data, verbose, id });
      },
      stderr: (data) => {
        snap.log({ kind: 'stderr', data, verbose: !this.isQuiet(), id });
      },
      end: (data, c) => this.onEnd(data, c),
    };
  }

  onEnd(data, c) {
    const snap = this._snapshot;
    const { store } = data.ctx;
    const breaker = this._breakerData || {};
    const signal = breaker.signal ?? data.signal ?? null;
    const code = breaker.exitCode ?? data.status ?? null;
    const error = breaker.cause ?? data.error ?? null;
    const { duration } = data;
    const output = new ProcessOutput({
      code,
      signal,
      error,
      duration,
      store,
      from: snap.from,
    });
    const verbose = this.isVerbose();
    snap.log({
      kind: 'end',
      signal,
      exitCode: code,
      duration,
      error,
      verbose,
      id: this.id,
    });
    // Make sure the echoed output ends with a line break.
    for (const kind of ['stdout', 'stderr']) {
      if (store[kind].length && getLast(getLast(store[kind])) !== BR_CC) {
        c.on[kind](EOL, c);
      }
    }
    this.finalize(output);
  }

  break(exitCode, signal, cause) {
    if (!this.isRunning()) {
      return;
    }
    this._breakerData = { exitCode, signal, cause };
    this.kill(signal);
  }

  finalize(output, legacy = false) {
    if (this.isSettled()) {
      return;
    }
    this._output = output;
    bus.unpipeBack(this);
    if (output.ok || this.isNothrow()) {
      this._stage = 'fulfilled';
      this._resolve(output);
      return;
    }
    this._stage = 'rejected';
    if (legacy) {
      // Resolve first to avoid an unhandled rejection, then surface the
      // configuration error synchronously.
      this._resolve(output);
      throw output.cause || output;
    }
    if (this.sync) {
      this._resolve(output);
      throw output;
    }
    this._reject(output);
  }

  abort(reason) {
    if (this.isSettled()) {
      throw new Fail('Too late to abort the process.');
    }
    if (this.signal !== this.ac.signal) {
      throw new Fail('The signal is controlled by another process.');
    }
    if (!this.child) {
      throw new Fail('Trying to abort a process without creating one.');
    }
    this.ac.abort(reason);
  }

  kill(signal) {
    if (this.isSettled()) {
      throw new Fail('Too late to kill the process.');
    }
    if (!this.child) {
      throw new Fail('Trying to kill a process without creating one.');
    }
    if (!this.pid) {
      throw new Fail('The process pid is undefined.');
    }
    return $.kill(
      this.pid,
      signal || this._snapshot.killSignal || $.killSignal
    );
  }

  // Configurators
  stdio(stdin, stdout = 'pipe', stderr = 'pipe') {
    this._snapshot.stdio = Array.isArray(stdin)
      ? stdin
      : [stdin, stdout, stderr];
    return this;
  }

  nothrow(v = true) {
    this._snapshot.nothrow = v;
    return this;
  }

  quiet(v = true) {
    this._snapshot.quiet = v;
    return this;
  }

  verbose(v = true) {
    this._snapshot.verbose = v;
    return this;
  }

  timeout(d = 0, signal = $.timeoutSignal) {
    if (this.isSettled()) {
      return this;
    }
    const snap = this._snapshot;
    snap.timeout = parseDuration(d);
    snap.timeoutSignal = signal;
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }
    if (snap.timeout && this.isRunning()) {
      this._timeoutId = setTimeout(
        () => this.kill(snap.timeoutSignal),
        snap.timeout
      );
      this.finally(() => clearTimeout(this._timeoutId)).catch(noop);
    }
    return this;
  }

  /** @deprecated Use $({halt: true})`cmd` instead. */
  halt() {
    return this;
  }

  // Getters
  get id() {
    return this._id;
  }

  get pid() {
    return this.child?.pid;
  }

  get cwd() {
    return this._snapshot.cwd || this._snapshot[CWD];
  }

  get cmd() {
    return this._snapshot.cmd;
  }

  get fullCmd() {
    const { prefix = '', postfix = '', cmd } = this._snapshot;
    return prefix + cmd + postfix;
  }

  get child() {
    return this._zurk?.child;
  }

  get stdin() {
    return this.child?.stdin;
  }

  get stdout() {
    return this.child?.stdout;
  }

  get stderr() {
    return this.child?.stderr;
  }

  get exitCode() {
    return this.then(
      (o) => o.exitCode,
      (o) => o.exitCode
    );
  }

  get signal() {
    return this._snapshot.signal || this.ac.signal;
  }

  get ac() {
    return this._snapshot.ac;
  }

  get output() {
    return this._output;
  }

  get stage() {
    return this._stage;
  }

  get sync() {
    return this._snapshot[SYNC];
  }

  get [Symbol.toStringTag]() {
    return 'ProcessPromise';
  }

  [Symbol.toPrimitive]() {
    return this.toString();
  }

  // Output formatters
  json() {
    return this.then((o) => o.json());
  }

  text(encoding) {
    return this.then((o) => o.text(encoding));
  }

  lines(delimiter) {
    return this.then((o) => o.lines(delimiter));
  }

  buffer() {
    return this.then((o) => o.buffer());
  }

  blob(type) {
    return this.then((o) => o.blob(type));
  }

  // Status checkers
  isQuiet() {
    return this._snapshot.quiet;
  }

  isVerbose() {
    return this._snapshot.verbose && !this.isQuiet();
  }

  isNothrow() {
    return this._snapshot.nothrow;
  }

  isHalted() {
    return this.stage === 'halted' && !this.sync;
  }

  isSettled() {
    return !!this.output;
  }

  isRunning() {
    return this.stage === 'running';
  }

  // Piping
  get pipe() {
    const method = (kind) => this._pipe.bind(this, kind);
    const stdout = method('stdout');
    return Object.assign(stdout, {
      stdout,
      stderr: method('stderr'),
      stdall: method('stdall'),
    });
  }

  unpipe(to) {
    bus.unpipe(this, to);
    return this;
  }

  _pipe(source, dest, ...args) {
    if (isString(dest)) {
      return this._pipe(source, fs.createWriteStream(dest));
    }
    if (isStringLiteral(dest, ...args)) {
      const next = $({ halt: true, signal: this.signal })(dest, ...args);
      return this._pipe(source, next);
    }
    const isP = dest instanceof ProcessPromise;
    if (isP && dest.isSettled()) {
      throw new Fail('Cannot pipe to a settled process.');
    }
    if (!isP && dest.writableEnded) {
      throw new Fail('Cannot pipe to a closed stream.');
    }
    this._piped = true;
    bus.pipe(this, dest);
    const from = this.feedPipe(source, dest, isP);
    if (isP) {
      from.pipe(dest._stdin);
      if (this.isHalted()) {
        this._snapshot.ee.once('start', () => dest.run());
      } else {
        dest.run();
        this.catch((e) => dest.break(e.exitCode, e.signal, e.cause));
      }
      this.fillSettled(from, source, dest, isP);
      return dest;
    }
    from.once('end', () => dest.emit(EPF)).pipe(dest);
    this.fillSettled(from, source, dest, isP);
    return promisifyStream(dest, this);
  }

  // Build the intermediate stream that replays buffered chunks and then
  // forwards live ones while `dest` stays attached.
  feedPipe(source, dest) {
    const from = new VoidStream();
    if (this.output) {
      return from;
    }
    const { ee } = this._snapshot;
    const onData = (chunk) =>
      bus.refs.get(this)?.has(dest) && from.write(chunk);
    ee.once(source, () => {
      this.fillPipe(from, source);
      ee.on(source, onData);
    }).once('end', () => {
      ee.removeListener(source, onData);
      this.endPipe(from, dest);
    });
    return from;
  }

  fillPipe(from, source) {
    for (const chunk of this._zurk.store[source]) {
      from.write(chunk);
    }
  }

  endPipe(from, dest) {
    if (!bus.refs.get(this)?.has(dest)) {
      return;
    }
    setImmediate(() => {
      bus.unpipe(this, dest);
      if (bus.sources(dest).length === 0) {
        from.end();
      }
    });
  }

  fillSettled(from, source, dest, isP) {
    const output = this.output;
    if (!output) {
      return;
    }
    if (isP && !output.ok) {
      dest.break(output.exitCode, output.signal, output.cause);
    }
    this.fillPipe(from, source);
    this.endPipe(from, dest);
  }

  // Promise API
  then(onfulfilled, onrejected) {
    return super.then(onfulfilled, onrejected);
  }

  catch(onrejected) {
    return super.catch(onrejected);
  }

  // Async iterator API
  async *[Symbol.asyncIterator]() {
    const memo = [];
    const delimiter = this._snapshot.delimiter || $.delimiter || DLMTR;
    for (const chunk of this._zurk.store.stdout) {
      yield* getLines(chunk, memo, delimiter);
    }
    for await (const chunk of this.stdout || []) {
      yield* getLines(chunk, memo, delimiter);
    }
    if (memo[0]) {
      yield memo[0];
    }
    await this;
  }

  // Stream-like API so a ProcessPromise can be a `stream.pipe()` target.
  emit() {
    return this;
  }

  on(event, cb) {
    this._stdin.on(event, cb);
    return this;
  }

  once(event, cb) {
    this._stdin.once(event, cb);
    return this;
  }

  write(data, encoding, cb) {
    this._stdin.write(data, encoding, cb);
    return this;
  }

  end(chunk, cb) {
    this._stdin.end(chunk, cb);
    return this;
  }

  removeListener(event, cb) {
    this._stdin.removeListener(event, cb);
    return this;
  }

  // Promises derived via `.then()` share the class but not the process:
  // make every ProcessPromise-only member throw on them.
  static disarm(p, toggle = true) {
    for (const key of Object.getOwnPropertyNames(ProcessPromise.prototype)) {
      if (key in Promise.prototype) {
        continue;
      }
      if (!toggle) {
        Reflect.deleteProperty(p, key);
        continue;
      }
      Object.defineProperty(p, key, {
        configurable: true,
        get() {
          throw new Fail(
            'Inappropriate usage. Apply $ instead of direct instantiation.'
          );
        },
      });
    }
  }

  static bus = bus;
}
