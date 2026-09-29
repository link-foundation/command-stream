import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const heartbeat =
  process.argv[2] === 'child' ? process.argv[3] : process.argv[2];

if (process.argv[2] === 'child') {
  setInterval(() => appendFileSync(heartbeat, 'x'), 20);
} else {
  const child = spawn(process.execPath, [process.argv[1], 'child', heartbeat], {
    stdio: 'ignore',
  });
  while (!existsSync(heartbeat)) {
    await sleep(10);
  }
  console.log(`CHILD_PID=${child.pid}`);
  setInterval(() => {}, 1000);
}
