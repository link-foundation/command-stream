import os from 'node:os';
import { trace } from './$.trace.mjs';

// Older Bun releases name Darwin signals with Linux's table (oven-sh/bun#35296).
const darwinSignalNames = {
  SIGBUS: 'SIGEMT',
  SIGUSR1: 'SIGBUS',
  SIGUSR2: 'SIGSYS',
  SIGSTKFLT: 'SIGURG',
  SIG16: 'SIGURG',
  SIGCHLD: 'SIGSTOP',
  SIGCONT: 'SIGTSTP',
  SIGSTOP: 'SIGCONT',
  SIGTSTP: 'SIGCHLD',
  SIGURG: 'SIGIO',
  SIGIO: 'SIGINFO',
  SIGPWR: 'SIGUSR1',
  SIGSYS: 'SIGUSR2',
};

let bunUsesLinuxSignalNames;

function usesLinuxSignalNames() {
  if (bunUsesLinuxSignalNames === undefined) {
    // Sync results have no numeric exit code on signal death. Detect the old
    // naming table once, only when an ambiguous Darwin signal requires it.
    // The finite shell only signals itself; common signals need no probe.
    const probe = globalThis.Bun.spawnSync(['/bin/sh', '-c', 'kill -USR1 $$'], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    bunUsesLinuxSignalNames = probe.signalCode === 'SIGPWR';
    trace(
      'ProcessRunner',
      () => `Bun uses Linux signal names on Darwin: ${bunUsesLinuxSignalNames}`
    );
  }
  return bunUsesLinuxSignalNames;
}

/** Normalize an observed Bun exit signal; never use for requested kill signals. */
export function normalizeBunExitSignal(
  code,
  signal,
  {
    platform = process.platform,
    signals = os.constants.signals,
    detectLinuxNames = usesLinuxSignalNames,
  } = {}
) {
  if (!signal || platform !== 'darwin') {
    return signal ?? null;
  }

  // Bun's native async status retains the OS number even when its name is
  // wrong. Prefer that evidence over the compatibility table.
  if (typeof code === 'number' && code >= 128) {
    const number = code - 128;
    if (signals[signal] === number) {
      return signal;
    }
    const entry = Object.entries(signals).find(([, value]) => value === number);
    if (entry) {
      return entry[0];
    }
  }

  const corrected = darwinSignalNames[signal];
  if (corrected && (!signals[signal] || detectLinuxNames())) {
    return corrected;
  }
  return signal;
}
