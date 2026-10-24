import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const heartbeat =
  process.argv[2] === 'child' ? process.argv[3] : process.argv[2];

// Bound failures even if the test cannot recover the child PID for cleanup.
setTimeout(() => process.exit(0), 10_000);

if (process.argv[2] === 'child') {
  if (process.env.COMMAND_STREAM_TEST_IGNORE_TERM === '1') {
    process.on('SIGTERM', () => {});
  }
  setInterval(() => appendFileSync(heartbeat, 'x'), 20);
} else {
  const child = spawn(process.execPath, [process.argv[1], 'child', heartbeat], {
    stdio: 'ignore',
  });
  writeFileSync(`${heartbeat}.pid`, String(child.pid));
  while (!existsSync(heartbeat)) {
    await sleep(10);
  }
  console.log(`CHILD_PID=${child.pid}`);
  setInterval(() => {}, 1000);
}
