# Sending signals to a running command

How `kill()`, the `killSignal` and `killGrace` options and an `AbortSignal`
stop a command. The overview is in the README under
[Sending Signals to a Running Command](../README.md#sending-signals-to-a-running-command);
exit codes of signal-terminated processes are also covered in
[Signal termination](SIGNAL_TERMINATION.md).

## What `kill()` actually does

On Linux and macOS, `kill()` runs the following four steps:

1. The requested signal is delivered to the child **and its process group**, so
   a grandchild behind a shell wrapper is reached too (see
   [Grandchildren and process groups](#grandchildren-and-process-groups)).
2. The child is given a grace period (`killGrace`, default `100`ms) to run its
   own signal handler and exit on its own terms.
3. If it is still alive when the grace period expires, `SIGKILL` follows, so a
   process that ignores the signal is still guaranteed to terminate.
4. The reported exit code is the conventional `128 + signal` value.

On Windows, `kill()`, stream cancellation and an `AbortSignal` immediately stop the tree with `taskkill /PID <pid> /T /F` before the parent exits.
`killGrace` applies only to POSIX shutdown. If `taskkill` fails, termination falls back to the direct child. Exit codes reflect the requested signal.

Step 2 is what makes a shutdown _graceful_: without it, a child that traps
SIGTERM to flush output, release a lock, or stop its own workers is destroyed
before its handler can run.

```javascript
// A child that cleans up when asked to stop:
const cmd = $`sh -c 'trap "echo cleaning up; exit 0" TERM; while true; do sleep 1; done'`;
cmd.start();
cmd.kill(); // the trap runs, prints "cleaning up", and exits

const result = await cmd;
console.log(result.code); // 143
```

## Choosing the stop signal

Pass a signal explicitly, or configure a default with the `killSignal` option so
that an argument-less `kill()`, a `break` out of a stream loop, and an
`AbortSignal` all use it:

```javascript
// Explicit per-call signal — overrides killSignal for this call only:
cmd.kill('SIGINT'); // exit code 130

// Configured default — used by kill(), break, and AbortSignal cancellation:
const cmd = $({ killSignal: 'SIGINT' })`some-endless-stream`;
for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout' && done(chunk))
    cmd.kill(); // sends SIGINT
  else if (chunk.type === 'exit') console.log(chunk.code); // 130
}

// AbortSignal style also honors killSignal — awaiting resolves promptly when
// the signal fires (it does not hang) with the configured signal's exit code:
const ac = new AbortController();
const running = $({
  signal: ac.signal,
  killSignal: 'SIGINT',
})`some-endless-stream`;
setTimeout(() => ac.abort(), 1000); // stops with SIGINT
console.log((await running).code); // 130
```

## Tuning the grace period

`killGrace` is the number of milliseconds between the requested signal and the
SIGKILL escalation:

```javascript
// Give a slow shutdown more room:
const cmd = $({ killGrace: 5000 })`./server --graceful-shutdown`;

// Opt out entirely — SIGKILL is sent immediately, with no chance to clean up:
const cmd = $({ killGrace: 0 })`stuck-process`;
```

With `killGrace: 0` the requested signal is not delivered at all — only
`SIGKILL` is. Delivering it first and then killing would leave a window the
child can be scheduled in, which makes "no grace" a race rather than a
guarantee. The reported exit code still reflects the signal you requested.

`SIGKILL` is never delayed: it cannot be caught, so `kill('SIGKILL')` skips the
grace period regardless of the `killGrace` value.

## Signal exit codes

A process stopped by a signal reports `128 + signal`, the same convention POSIX
shells use:

| Signal    | Number | Exit code | Typical meaning                      |
| --------- | ------ | --------- | ------------------------------------ |
| `SIGHUP`  | 1      | `129`     | Terminal closed / reload config      |
| `SIGINT`  | 2      | `130`     | CTRL+C                               |
| `SIGQUIT` | 3      | `131`     | Quit from keyboard                   |
| `SIGKILL` | 9      | `137`     | Forced termination, cannot be caught |
| `SIGUSR1` | 10     | `138`     | Application-defined                  |
| `SIGUSR2` | 12     | `140`     | Application-defined                  |
| `SIGTERM` | 15     | `143`     | Polite request to stop (the default) |

The code reflects the signal **you requested**, even when the SIGKILL escalation
is what ultimately stopped the process — `kill('SIGTERM')` on a child that
ignores SIGTERM still reports `143`, not `137`.

## Grandchildren and process groups

Commands run through a shell, so `$\`sh -c '...'\`` is usually a shell wrapper
with the real work in a grandchild. Signals are delivered to the whole process
group rather than just the direct child, so the grandchild is stopped too —
including the common case where the wrapper dies on the first signal and the
grandchild is reparented to init.

The one exception is interactive mode, where the command shares your terminal
and is spawned into the caller's process group so that CTRL+C keeps reaching it.
There `kill()` signals the direct child alone — but CTRL+C from the terminal
already reaches the whole group anyway.

There is a limit to this. If the shell itself exits and leaves a background
worker behind, the command is finished as far as the runner is concerned, and
Node and Bun have already reaped the shell — which frees its pid, and with it
the group id, for reuse. A later `kill()` therefore signals nothing rather than
risk signalling an unrelated process group, and the orphaned worker keeps
running, exactly as it would if you had started it from your own shell. Keep the
worker in the foreground (`... & wait`, or no `&` at all) if you want `kill()`
to reach it.
