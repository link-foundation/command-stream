/**
 * Signal handling tests (issue #15).
 *
 * These cover the documented contract for stopping a running command: which
 * signal is delivered, that the child gets a chance to handle it, that a
 * process ignoring it is still terminated, and which exit code is reported.
 *
 * The Rust counterpart is `rust/tests/signals.rs`; both suites assert the same
 * behavior so the two implementations stay in parity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $ } from '../src/$.mjs';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Signals are a Unix concept; Windows terminates processes by other means.
const isWindows = process.platform === 'win32';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll until `condition` holds, failing with a clear message after `timeout`
// milliseconds rather than hanging or racing a fixed sleep. Fixed sleeps were
// what made these tests flaky on loaded runners (issue #216).
const waitFor = async (condition, what, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeout} ms waiting for ${what}`);
    }
    await sleep(10);
  }
};

/**
 * Grace period for the tests that assert a handler ran. The 100 ms default is
 * the documented contract, but a busy runner can take longer than that to
 * schedule the shell and run its trap, at which point the SIGKILL escalation
 * legitimately cuts the handler off: macOS run 37487515414 failed that way.
 * The escalation is skipped once the child exits, so a prompt handler costs
 * nothing extra. Matches GRACEFUL_KILL_GRACE_MS in rust/tests/signals.rs.
 */
const GRACEFUL_KILL_GRACE = 2000;

describe.skipIf(isWindows)('Signal handling', () => {
  let workDir;

  beforeEach(async () => {
    await beforeTestCleanup();
    workDir = mkdtempSync(join(tmpdir(), 'cs-signals-'));
  });

  afterEach(async () => {
    rmSync(workDir, { recursive: true, force: true });
    await afterTestCleanup();
  });

  /**
   * A command that traps a signal, records that its handler ran, and exits.
   *
   * Writing to a marker file is what distinguishes "the child handled the
   * signal" from "the child was destroyed before it could": an exit code alone
   * cannot tell the two apart, because the reported code is derived from the
   * signal that was requested either way.
   */
  const gracefulChild = (marker, signals = 'TERM INT') =>
    `trap 'echo handled >> ${marker}; exit 0' ${signals}; ` +
    `echo ready; while true; do sleep 0.05; done`;

  const handlerRan = (marker) => {
    try {
      return readFileSync(marker, 'utf8').includes('handled');
    } catch {
      return false;
    }
  };

  const fileSize = (path) => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  };

  // Start a command and wait until it prints `ready`. Every command here
  // installs its traps before printing it, so a signal sent afterwards cannot
  // arrive before the handler exists. The runner is wrapped because it is
  // thenable: an async function returning it bare would wait for it to exit.
  const startReady = async (command, options) => {
    const cmd = $({ mirror: false, ...options })`sh -c ${command}`;
    let output = '';
    cmd.on('stdout', (chunk) => {
      output += chunk;
    });
    cmd.start();
    await waitFor(() => output.includes('ready'), 'the child to start');
    return { cmd };
  };

  // Start a command, wait for it to be running, then stop it.
  const startAndKill = async (command, options, kill) => {
    const { cmd } = await startReady(command, options);
    kill(cmd);
    return await cmd;
  };

  describe('graceful termination', () => {
    it('lets the child run its SIGTERM handler before exiting', async () => {
      const marker = join(workDir, 'marker');

      const result = await startAndKill(
        gracefulChild(marker),
        { killGrace: GRACEFUL_KILL_GRACE },
        (cmd) => cmd.kill()
      );

      await waitFor(() => handlerRan(marker), 'the signal handler');
      expect(result.code).toBe(143); // 128 + SIGTERM(15)
    });

    it('delivers an explicit per-call signal override', async () => {
      const marker = join(workDir, 'marker');

      // SIGINT is the signal CTRL+C sends.
      const result = await startAndKill(
        gracefulChild(marker),
        { killGrace: GRACEFUL_KILL_GRACE },
        (cmd) => cmd.kill('SIGINT')
      );

      await waitFor(() => handlerRan(marker), 'the signal handler');
      expect(result.code).toBe(130); // 128 + SIGINT(2)
    });

    it('delivers the configured killSignal when kill() takes no argument', async () => {
      const marker = join(workDir, 'marker');

      // Only INT is trapped, so the marker proves SIGINT (not the SIGTERM
      // default) was the signal actually delivered.
      const result = await startAndKill(
        gracefulChild(marker, 'INT'),
        { killSignal: 'SIGINT', killGrace: GRACEFUL_KILL_GRACE },
        (cmd) => cmd.kill()
      );

      await waitFor(() => handlerRan(marker), 'the signal handler');
      expect(result.code).toBe(130);
    });
  });

  describe('forceful escalation', () => {
    it('escalates to SIGKILL when the child ignores the signal', async () => {
      const heartbeat = join(workDir, 'heartbeat');
      // Ignores TERM and INT, and appends while it runs. Whether the heartbeat
      // keeps growing is the evidence that the process is still executing.
      const command =
        `trap '' TERM INT; echo ready; ` +
        `while true; do echo tick >> ${heartbeat}; sleep 0.05; done`;

      const { cmd } = await startReady(command, { killGrace: 50 });
      await waitFor(() => fileSize(heartbeat) > 0, 'the first heartbeat');

      cmd.kill();
      // Wait out the grace period plus the SIGKILL escalation.
      await sleep(500);
      const afterKill = fileSize(heartbeat);
      // If the process were still alive it would keep appending here.
      await sleep(500);

      expect(fileSize(heartbeat)).toBe(afterKill);
    });

    it('killGrace: 0 escalates immediately without waiting', async () => {
      const marker = join(workDir, 'marker');

      const result = await startAndKill(
        gracefulChild(marker),
        { killGrace: 0 },
        (cmd) => cmd.kill()
      );

      // The reported code still reflects the requested signal, even though the
      // process was actually stopped by the SIGKILL escalation.
      expect(result.code).toBe(143);
      // Give a handler that wrongly survived time to write its marker.
      await sleep(300);
      // With no grace period the child never gets to run its handler.
      expect(handlerRan(marker)).toBe(false);
    });
  });

  describe('process group', () => {
    it('reaches grandchildren, not just the direct child', async () => {
      const heartbeat = join(workDir, 'heartbeat');
      // The real work runs in a grandchild behind a shell that waits, so
      // signalling only the direct child would leave the worker running.
      // Delivering to the process group is what reaches it.
      const command =
        `sh -c 'while true; do echo tick >> ${heartbeat}; sleep 0.05; done' & ` +
        `echo ready; wait`;

      const { cmd } = await startReady(command, { killGrace: 50 });
      // `ready` comes from the waiting shell; the grandchild may not have
      // written yet.
      await waitFor(() => fileSize(heartbeat) > 0, 'the first heartbeat');

      cmd.kill();
      // Past the grace period, so the escalation has been delivered too.
      await sleep(400);
      const afterKill = fileSize(heartbeat);
      // A surviving grandchild would keep appending here.
      await sleep(400);

      expect(fileSize(heartbeat)).toBe(afterKill);
    });

    // There is deliberately no counterpart to the Rust
    // `process_runner_kill_reaches_a_grandchild_whose_parent_already_exited`
    // test here: once the shell exits, Node and Bun reap it and the runner is
    // finished, so its pid - and with it the group id - can be reused by an
    // unrelated process. Signalling that group would be worse than leaving the
    // grandchild running. Rust can make the guarantee because its runner keeps
    // the unreaped child, which holds the group id reserved.
  });

  describe('exit codes', () => {
    it('follows the 128 + signal convention', async () => {
      // A child that ignores nothing, stopped with a range of signals.
      const cases = [
        ['SIGHUP', 129],
        ['SIGINT', 130],
        ['SIGQUIT', 131],
        ['SIGKILL', 137],
        ['SIGTERM', 143],
      ];

      for (const [signal, expected] of cases) {
        const result = await startAndKill(
          'echo ready; while true; do sleep 0.05; done',
          {},
          (cmd) => cmd.kill(signal)
        );
        expect(result.code).toBe(expected);
      }
    });
  });
});
