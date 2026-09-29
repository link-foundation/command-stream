// External command execution for the Bun Shell interpreter, ported from
// Bun's `ShellSubprocess` (src/runtime/shell/subproc.rs) and the subprocess
// half of the `Cmd` state (states/Cmd.rs).
//
// Bun hands its IO objects to the child as raw fds; pipeline channels are
// in-memory here, so they are pumped through Node pipes instead. Outputs that
// Bun buffers (`Pipe`, and `Capture` for the non-quiet root stdout/stderr)
// are collected and appended to the shell's buffers once the pipe closes.

import { spawn } from 'node:child_process';
import os from 'node:os';
import { ByteList, ChannelTarget, FdTarget, StreamTarget } from './io.mjs';
import { RedirectFlags } from './lexer.mjs';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Bun's `RedirectFlags::redirects_elsewhere`: whether the command's own
 * redirect sends `which` somewhere other than the shell's IO.
 */
export function redirectsElsewhere(flags, which) {
  const bit = which === 'stdout' ? RedirectFlags.STDOUT : RedirectFlags.STDERR;
  return flags & RedirectFlags.DUPLICATE_OUT
    ? !(flags & bit)
    : Boolean(flags & bit);
}

/** Collects everything the child writes (Bun's `BufferedOutput::Bytelist`). */
class BufferSink {
  constructor() {
    this.buf = new ByteList();
  }

  write(chunk) {
    this.buf.append(chunk);
  }

  slice() {
    return this.buf.toBuffer();
  }
}

/**
 * Writes into a JS ArrayBuffer view, silently truncating on overflow
 * (Bun's `BufferedOutput::ArrayBuffer`).
 */
class ViewSink {
  constructor(view) {
    this.view = view;
    this.i = 0;
  }

  write(chunk) {
    if (this.i >= this.view.length) {
      return;
    }
    const n = Math.min(this.view.length - this.i, chunk.length);
    this.view.set(chunk.subarray(0, n), this.i);
    this.i += n;
  }

  slice() {
    return Buffer.from(
      this.view.buffer,
      this.view.byteOffset,
      this.view.byteLength
    );
  }
}

/**
 * Bun's `Capture`: buffer the output and tee every chunk to the shell's
 * writer (the real stdout/stderr). A failed tee is reported as the exit code.
 */
class TeeSink extends BufferSink {
  constructor(writer) {
    super();
    this.writer = writer;
    this.last = Promise.resolve(null);
    this.err = null;
  }

  write(chunk) {
    super.write(chunk);
    this.last = this.writer.write(chunk, null).then((err) => {
      this.err ??= err;
      return err;
    });
  }

  flush() {
    return this.last;
  }
}

/** Forwards output into a Writer with backpressure (a pipeline channel). */
class WriterSink {
  constructor(writer) {
    this.writer = writer;
    this.last = Promise.resolve(null);
  }

  async write(chunk) {
    this.last = this.writer.write(chunk, null);
    const err = await this.last;
    if (err) {
      throw err;
    }
  }

  flush() {
    return this.last;
  }
}

function fdOfWriter(writer) {
  const t = writer.target;
  if (t instanceof FdTarget) {
    return t.fd;
  }
  if (t instanceof StreamTarget && typeof t.stream.fd === 'number') {
    return t.stream.fd;
  }
  return null;
}

/**
 * How one output of the child is wired: `stdio` for spawn(), an optional
 * `sink` fed from the child's pipe and an optional `capture` ByteList that
 * receives the sink's bytes once the pipe closes.
 */
function planOut(out, override, bufferedTarget, elsewhere) {
  if (override?.fd !== undefined) {
    return { stdio: override.fd };
  }
  if (override?.view) {
    const sink = new ViewSink(override.view);
    let capture = null;
    if (!elsewhere) {
      capture = out.kind === 'fd' ? out.captured : null;
      capture = out.kind === 'pipe' ? bufferedTarget : capture;
    }
    return { stdio: 'pipe', sink, capture };
  }
  switch (out.kind) {
    case 'fd': {
      if (out.captured) {
        return {
          stdio: 'pipe',
          sink: new TeeSink(out.writer),
          capture: elsewhere ? null : out.captured,
        };
      }
      const fd = fdOfWriter(out.writer);
      if (fd !== null) {
        return { stdio: fd };
      }
      if (out.writer.target instanceof ChannelTarget) {
        return { stdio: 'pipe', sink: new WriterSink(out.writer) };
      }
      return { stdio: 'inherit' };
    }
    case 'pipe':
      return {
        stdio: 'pipe',
        sink: new BufferSink(),
        capture: elsewhere ? null : bufferedTarget,
      };
    default:
      return { stdio: 'ignore' };
  }
}

function planIn(input, override) {
  if (override?.fd !== undefined) {
    return { stdio: override.fd };
  }
  if (override?.bytes) {
    return override.bytes.length === 0
      ? { stdio: 'ignore' }
      : { stdio: 'pipe', bytes: override.bytes };
  }
  if (input.kind !== 'fd') {
    return { stdio: 'ignore' };
  }
  const src = input.reader.source;
  if (src.type === 'fd') {
    return { stdio: src.fd };
  }
  if (src.type === 'stdin') {
    return { stdio: 'inherit' };
  }
  return { stdio: 'pipe', reader: input.reader };
}

/**
 * `2>&1` / `1>&2` without a file (Bun's `Stdio::Dup2`). When the target is a
 * pipe we own, POSIX children get a real dup2 through `sh -c 'exec ...'`
 * (keeping the interleaving exact); on Windows both pipes feed the target's
 * sink.
 */
function applyDup(plans, dup, argv) {
  const [from, to] = dup === 'stderr-to-stdout' ? [2, 1] : [1, 2];
  const target = plans[to];
  if (target.stdio !== 'pipe') {
    plans[from] = {
      stdio: target.stdio === 'inherit' ? to : target.stdio,
    };
    return argv;
  }
  if (IS_WINDOWS) {
    plans[from] = { stdio: 'pipe', sink: target.sink, capture: null };
    return argv;
  }
  plans[from] = { stdio: 'ignore' };
  return ['/bin/sh', '-c', `exec "$0" "$@" ${from}>&${to}`, ...argv];
}

function quoteWindowsArg(arg) {
  if (arg.length > 0 && !/[\s"]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
}

/** Batch files have to run through cmd.exe (Bun does the same). */
function windowsSpawnArgs(argv) {
  if (!/\.(bat|cmd)$/i.test(argv[0])) {
    return { file: argv[0], args: argv.slice(1), verbatim: false };
  }
  const comspec = process.env.ComSpec || 'cmd.exe';
  const line = argv.map(quoteWindowsArg).join(' ');
  return {
    file: comspec,
    args: ['/d', '/s', '/c', `"${line}"`],
    verbatim: true,
  };
}

function feedStdin(stream, plan, childDone) {
  if (!stream) {
    return;
  }
  stream.on('error', () => {});
  if (plan.bytes) {
    stream.end(Buffer.from(plan.bytes));
    return;
  }
  if (!plan.reader) {
    return;
  }
  (async () => {
    for await (const chunk of plan.reader.chunks()) {
      if (childDone() || stream.destroyed) {
        return;
      }
      if (!stream.write(chunk)) {
        await new Promise((resolve) => {
          stream.once('drain', resolve);
          stream.once('close', resolve);
        });
      }
    }
    if (!stream.destroyed) {
      stream.end();
    }
  })().catch(() => stream.destroy());
}

/**
 * Pump a child's output into a pipeline channel. Node connects child stdio
 * through a socketpair, and closing it with unread data makes the child's
 * next write fail with ECONNRESET (grep then prints "write error:
 * Connection reset by peer"). Bun uses real pipes, where that write raises
 * SIGPIPE instead; so once the reader is gone, keep draining and deliver the
 * SIGPIPE ourselves if the child writes again.
 */
function pumpToChannel(stream, sink, child) {
  let broken = false;
  stream.on('data', (chunk) => {
    if (broken) {
      child.kill('SIGPIPE');
      return;
    }
    stream.pause();
    sink.write(chunk).then(
      () => stream.resume(),
      () => {
        if (IS_WINDOWS) {
          stream.destroy();
          return;
        }
        broken = true;
        stream.resume();
      }
    );
  });
}

function drainOutput(stream, plan, child) {
  if (!stream) {
    return;
  }
  stream.on('error', () => {});
  const { sink } = plan;
  if (sink instanceof WriterSink) {
    pumpToChannel(stream, sink, child);
    return;
  }
  stream.on('data', (chunk) => sink.write(chunk));
}

function signalExitCode(signal) {
  const n = os.constants.signals[signal];
  return typeof n === 'number' ? 128 + n : 1;
}

// The variables libuv copies from the parent into a Windows child's
// environment when they are missing (uv_spawn's `required_vars`). Node.js
// and Bun do this in libuv; Deno does not, and a Node.js child then aborts
// on startup without SYSTEMROOT.
const REQUIRED_WINDOWS_ENV = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];

/** `env` plus the libuv-required variables it lacks (case-insensitive). */
export function withRequiredWindowsEnv(env, parentEnv = process.env) {
  const have = new Set(Object.keys(env).map((k) => k.toUpperCase()));
  const parent = new Map(
    Object.entries(parentEnv).map(([k, v]) => [k.toUpperCase(), v])
  );
  const out = { ...env };
  for (const name of REQUIRED_WINDOWS_ENV) {
    if (!have.has(name) && parent.get(name) !== undefined) {
      out[name] = parent.get(name);
    }
  }
  return out;
}

// How long to wait for 'close' once the child has exited. 'close' also waits
// for the stdio pipes, and Bun occasionally never emits it on macOS (the
// conformance run hung on a plain `cat`); after this grace period the exit
// status is used as is.
const CLOSE_GRACE_MS = 2000;

/** The child's `{code, signal}`: from 'close', or from 'exit' plus a grace. */
function waitForClose(child) {
  return new Promise((resolve) => {
    let timer;
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('exit', (code, signal) => {
      timer = setTimeout(() => {
        if (process.env.COMMAND_STREAM_TRACE_SUBPROCESS === '1') {
          process.emitWarning(
            `bun-shell: no 'close' ${CLOSE_GRACE_MS}ms after exit (pid ${child.pid})`
          );
        }
        resolve({ code, signal });
      }, CLOSE_GRACE_MS);
      timer.unref?.();
    });
  });
}

/**
 * Spawn `args` (args[0] is the resolved executable) and wait until it has
 * exited and its output pipes are closed.
 *
 * @param {object} opts
 * @param {string[]} opts.args
 * @param {string} opts.cwd
 * @param {Record<string, string>} opts.env
 * @param {{stdin, stdout, stderr}} opts.io the command's IO
 * @param {number} opts.flags the command's RedirectFlags
 * @param {{stdin?, stdout?, stderr?}} opts.overrides redirect targets:
 *   `{fd}` for an opened file, `{bytes}` for stdin data, `{view}` for a JS
 *   buffer that receives the output
 * @param {'stderr-to-stdout'|'stdout-to-stderr'|null} opts.dup
 * @param {import('./env.mjs').ShellExecEnv} opts.shell
 * @param {() => void} [opts.onSpawn] called once the child has started (the
 *   caller can close the redirect fds it handed over)
 * @param {typeof spawn} [opts.spawnChild] process launcher (test seam)
 * @returns {Promise<{exitCode: number} | {spawnError: Error}>}
 */
export async function runSubprocess({
  args,
  cwd,
  env,
  io,
  flags,
  overrides = {},
  dup = null,
  shell,
  onSpawn,
  spawnChild = spawn,
}) {
  const plans = [
    planIn(io.stdin, overrides.stdin),
    planOut(
      io.stdout,
      overrides.stdout,
      shell.bufferedStdout,
      redirectsElsewhere(flags, 'stdout')
    ),
    planOut(
      io.stderr,
      overrides.stderr,
      shell.bufferedStderr,
      redirectsElsewhere(flags, 'stderr')
    ),
  ];
  const argv = dup ? applyDup(plans, dup, args) : args;
  const target = IS_WINDOWS
    ? windowsSpawnArgs(argv)
    : { file: argv[0], args: argv.slice(1), verbatim: false };

  let child;
  try {
    child = spawnChild(target.file, target.args, {
      cwd,
      env: IS_WINDOWS ? withRequiredWindowsEnv(env) : env,
      stdio: plans.map((p) => p.stdio),
      windowsHide: true,
      windowsVerbatimArguments: target.verbatim,
    });
  } catch (e) {
    return { spawnError: e };
  }
  // Bun's child_process shim has occasionally left macOS conformance cases
  // pending. Trace the blocked phase when explicitly requested by CI.
  let phase = 'spawn event';
  const slowTimer =
    process.env.COMMAND_STREAM_TRACE_SUBPROCESS === '1'
      ? setTimeout(() => {
          process.emitWarning(
            `bun-shell: slow subprocess in ${phase} (${argv[0]}, pid ${child.pid ?? 'none'})`
          );
        }, 3000)
      : null;
  slowTimer?.unref?.();
  // A short-lived child can write and exit before the spawn event's awaited
  // promise resumes (observed with Bun's child_process shim on macOS).
  // Subscribe to output and exit/close immediately so neither is lost.
  const closed = waitForClose(child);
  drainOutput(child.stdout, plans[1], child);
  drainOutput(child.stderr, plans[2], child);
  const spawnError = await new Promise((resolve) => {
    child.once('spawn', () => resolve(null));
    child.once('error', resolve);
  });
  onSpawn?.();
  if (spawnError) {
    clearTimeout(slowTimer);
    for (const s of child.stdio) {
      s?.destroy();
    }
    return { spawnError };
  }

  phase = 'close event';
  let done = false;
  feedStdin(child.stdin, plans[0], () => done);

  const { code, signal } = await closed;
  phase = 'output flush';
  done = true;
  let exitCode = code ?? signalExitCode(signal);
  for (const plan of [plans[1], plans[2]]) {
    if (!plan.sink) {
      continue;
    }
    await plan.sink.flush?.();
    if (plan.sink.err) {
      exitCode = plan.sink.err.errno;
    }
    plan.capture?.append(plan.sink.slice());
  }
  clearTimeout(slowTimer);
  return { exitCode };
}
