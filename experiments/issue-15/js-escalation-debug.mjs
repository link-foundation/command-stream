// Why does a child that ignores SIGTERM survive the SIGKILL escalation?
import { $ } from '../../js/src/$.mjs';
import { unlinkSync, statSync } from 'fs';

const hb = '/tmp/hb.txt';
try {
  unlinkSync(hb);
} catch {}

const command = `trap '' TERM INT; echo ready; while true; do echo tick >> ${hb}; sleep 0.05; done`;
const cmd = $({ mirror: false, killGrace: 50 })`sh -c ${command}`;
cmd.start();
await new Promise((r) => setTimeout(r, 300));

const pid = cmd.child?.pid;
console.log('options.killGrace =', JSON.stringify(cmd.options?.killGrace));
console.log('child.pid =', pid);

const alive = (p) => {
  try {
    process.kill(p, 0);
    return true;
  } catch {
    return false;
  }
};
const size = () => {
  try {
    return statSync(hb).size;
  } catch {
    return 0;
  }
};

cmd.kill();
for (const ms of [100, 300, 600, 1000]) {
  await new Promise((r) => setTimeout(r, ms === 100 ? 100 : 200));
  console.log(`t+${ms}ms direct-child-alive=${alive(pid)} heartbeat=${size()}`);
}
