#!/usr/bin/env node
// Sending signals to a running command (issue #15).
//
// Run it: node js/examples/signals-graceful-shutdown.mjs
//
// The worker below traps SIGTERM and SIGINT the way a real service does: it
// gets a chance to flush state and release resources before exiting. Each
// scenario prints whether that cleanup actually ran, which is the difference
// between a graceful stop and a process that was simply destroyed.
import { $ } from '../src/$.mjs';

// A stand-in for a service that must clean up before it stops.
const worker = `
  trap 'echo "[worker] SIGTERM received, flushing state"; exit 0' TERM
  trap 'echo "[worker] SIGINT received, flushing state"; exit 0' INT
  echo "[worker] started"
  while true; do sleep 0.1; done
`;

// A worker that refuses to stop, to show the SIGKILL escalation.
const stubbornWorker = `
  trap '' TERM INT
  echo "[worker] started, ignoring TERM and INT"
  while true; do sleep 0.1; done
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scenario(title, command, options, stop) {
  console.log(`\n=== ${title} ===`);
  const cmd = $({ mirror: true, ...options })`sh -c ${command}`;
  cmd.start();
  await sleep(300); // let the worker install its traps
  stop(cmd);
  const result = await cmd;
  console.log(`exit code: ${result.code}`);
}

// 1. The default: SIGTERM, with a grace period so the worker can clean up.
await scenario('Default kill() sends SIGTERM', worker, {}, (cmd) => cmd.kill());

// 2. SIGINT is exactly what CTRL+C sends, delivered programmatically.
await scenario('kill("SIGINT") — the signal CTRL+C sends', worker, {}, (cmd) =>
  cmd.kill('SIGINT')
);

// 3. killSignal makes SIGINT the default for kill(), break, and AbortSignal.
await scenario(
  'killSignal option configures the default',
  worker,
  { killSignal: 'SIGINT' },
  (cmd) => cmd.kill()
);

// 4. A slow shutdown needs a larger window than the 100ms default.
await scenario(
  'killGrace gives a slow shutdown more room',
  worker,
  { killGrace: 2000 },
  (cmd) => cmd.kill()
);

// 5. A process that ignores the signal is still guaranteed to terminate:
//    the grace period expires and SIGKILL follows. Note that no cleanup
//    message appears — there was no cleanup to run.
await scenario(
  'SIGKILL escalation stops a process that ignores the signal',
  stubbornWorker,
  { killGrace: 200 },
  (cmd) => cmd.kill()
);

// 6. killGrace: 0 opts out of graceful shutdown entirely. The worker traps
//    SIGTERM, but is destroyed before the handler can run — so no cleanup
//    message is printed, even though the exit code is still 143.
await scenario(
  'killGrace: 0 escalates immediately, skipping cleanup',
  worker,
  { killGrace: 0 },
  (cmd) => cmd.kill()
);

// 7. An AbortSignal stops the command with the configured killSignal.
console.log('\n=== AbortController stops the command ===');
const controller = new AbortController();
const running = $({
  mirror: true,
  signal: controller.signal,
  killSignal: 'SIGTERM',
})`sh -c ${worker}`;
setTimeout(() => controller.abort(), 300);
console.log(`exit code: ${(await running).code}`);

console.log('\nExit codes follow the 128 + signal convention:');
console.log('  SIGINT (2) => 130, SIGTERM (15) => 143, SIGKILL (9) => 137');
