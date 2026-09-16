// Experiment: which process does the reported pid name - the shell wrapper or
// the command itself? Answer decides how the docs must describe it.
import { $ } from '../js/src/$.mjs';
import { execSync } from 'node:child_process';

const cmd = $`/bin/sleep 2`;
await cmd.streams.stdout;
const pid = cmd.pid;
const ps = execSync(`ps -o pid=,ppid=,args= -p ${pid}`).toString().trim();
console.log('reported pid :', pid);
console.log('ps           :', ps);
console.log('children     :',
  execSync(`pgrep -P ${pid} -a || true`).toString().trim() || '(none)');
cmd.kill();
await cmd.catch(() => {});
