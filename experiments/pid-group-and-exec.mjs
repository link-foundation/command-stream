// Experiment: is the reported pid the process-group leader, and what does
// exec mode (no shell) report?
import { ProcessRunner } from '../js/src/process-runner.mjs';
import { $ } from '../js/src/$.mjs';
import { execSync } from 'node:child_process';

console.log('--- shell mode ---');
const shellCmd = $`/bin/sleep 2`;
await shellCmd.streams.stdout;
console.log(execSync(`ps -o pid=,pgid=,args= -p ${shellCmd.pid}`).toString().trim());
console.log('self pgid    :', process.pid, execSync(`ps -o pgid= -p ${process.pid}`).toString().trim());
shellCmd.kill();
await shellCmd.catch(() => {});

console.log('--- exec mode (no shell) ---');
const execCmd = new ProcessRunner({ mode: 'exec', file: '/bin/sleep', args: ['2'] });
await execCmd.streams.stdout;
console.log('reported pid :', execCmd.pid);
console.log(execSync(`ps -o pid=,pgid=,args= -p ${execCmd.pid}`).toString().trim());
execCmd.kill();
await execCmd.catch(() => {});
