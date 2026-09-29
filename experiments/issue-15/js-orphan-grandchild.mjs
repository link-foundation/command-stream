// Why does killing a command whose shell already exited leave the grandchild
// running in JavaScript? Prints the runner state at kill time.
import { $ } from '../../js/src/$.mjs';
import { mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'orphan-'));
const beat = join(dir, 'heartbeat');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const size = (p) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};

const command = `sh -c 'while true; do echo tick >> ${beat}; sleep 0.05; done' & echo ready`;
const cmd = $({ mirror: false, killGrace: 50 })`sh -c ${command}`;
cmd.start();
await sleep(400);

console.log('before kill:', {
  finished: cmd.finished,
  hasChild: Boolean(cmd.child),
  pid: cmd.child?.pid ?? null,
  beat: size(beat),
});

cmd.kill();
await sleep(400);
const afterKill = size(beat);
await sleep(400);
console.log('heartbeat after kill:', afterKill, '-> later:', size(beat));
process.exit(0);
