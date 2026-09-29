#!/usr/bin/env node
// Reading the process id of a started command (issue #18).
//
// Run it: node js/examples/process-pid-access.mjs
//
// `runner.pid` is the id of the operating system process behind a command.
// It is recorded when the process is spawned, so it stays readable after the
// command finishes - unlike `runner.child`, which is released during cleanup.
// The scenarios below cover when it becomes available, what it actually names,
// and what it is useful for.
//
// The inspection commands (`ps`, `pgrep`) make this a POSIX-only example; the
// `pid` property itself works everywhere.
import { $ } from '../src/$.mjs';
import { ProcessRunner } from '../src/process-runner.mjs';
import { execSync } from 'node:child_process';

// Mirroring is off so the scenario output stays readable.
const quiet = { mirror: false, capture: true };

// `sleep` is a built-in of this library (see scenario 3), so the real
// executable is spelled out whenever an actual process is needed.
const SLEEP = '/bin/sleep';

// 1. The id appears when the process is spawned, not when the runner is built.
//    Awaiting `streams.stdout` is the point at which the spawn has happened.
console.log('=== 1. Before, during and after the command ===');
const worker = $(quiet)`${SLEEP} 5`;
console.log(`before start:  ${worker.pid}`); // undefined - nothing spawned yet

worker.start();
await worker.streams.stdout; // resolves once the child exists

console.log(`while running: ${worker.pid}`);

worker.kill();
await worker.catch(() => {});

// The reason to record the id at spawn time: `child` is deliberately released
// when the command finishes, so `worker.child.pid` would throw here.
console.log(`after exit:    ${worker.pid} (child is ${worker.child})`);

// 2. A plain await needs no ceremony - the id is there once the result is.
console.log('\n=== 2. After a plain await ===');
const done = $(quiet)`sh -c 'echo done'`;
await done;
console.log(`pid: ${done.pid}`);

// 3. Built-in commands run inside this process, so there is no separate
//    process to identify and the id stays undefined. `echo` and `sleep` are
//    two of them, which is why the real `sleep` is used above.
console.log('\n=== 3. Built-in commands have no process id ===');
const builtin = $(quiet)`echo hello`;
await builtin;
console.log(`built-in echo:      ${builtin.pid}`);

const external = $(quiet)`/bin/echo hello`;
await external;
console.log(`/bin/echo instead:  ${external.pid}`);

// 4. What the id names. A command string is handed to a shell, so the id names
//    the process that shell put there: usually the shell itself, with the
//    command as its child, but some shells replace themselves with a single
//    simple command instead. Either way it leads its own process group, which
//    is how kill() reaches the whole tree.
console.log('\n=== 4. What the id names ===');
const shellRun = $(quiet)`${SLEEP} 30`;
await shellRun.streams.stdout;
const shellPid = shellRun.pid;

console.log(`pid ${shellPid} is: ${ps('args=', shellPid)}`);
console.log(`its process group:  ${ps('pgid=', shellPid)} (same as the pid)`);
const shellChildren = children(shellPid);
for (const childPid of shellChildren) {
  console.log(`  child ${childPid}: ${ps('args=', childPid)}`);
}
if (shellChildren.length === 0) {
  console.log('  no children — this shell replaced itself with the command');
}

// Signalling the whole group reaches the command under the shell. This is
// what kill() does internally; having the pid lets you do it yourself.
process.kill(-shellPid, 'SIGTERM');
await shellRun.catch(() => {});

// 5. `mode: 'exec'` skips the shell, so the id names the command directly.
console.log('\n=== 5. Exec mode names the command itself ===');
const direct = new ProcessRunner(
  { mode: 'exec', file: SLEEP, args: ['30'] },
  quiet
);
await direct.streams.stdout;
console.log(`pid ${direct.pid} is: ${ps('args=', direct.pid)}`);
direct.kill();
await direct.catch(() => {});

// 6. A practical use: asking whether the command is still alive. Signal 0
//    delivers nothing and only performs the existence check.
console.log('\n=== 6. Checking whether the command is still running ===');
const shortLived = $(quiet)`${SLEEP} 0.3`;
await shortLived.streams.stdout;
console.log(`running:  ${isAlive(shortLived.pid)}`);
await shortLived;
console.log(`finished: ${isAlive(shortLived.pid)}`);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ps(format, pid) {
  return execSync(`ps -o ${format} -p ${pid}`).toString().trim();
}

function children(pid) {
  // pgrep exits 1 when there is no match, which execSync turns into a throw.
  try {
    return execSync(`pgrep -P ${pid}`).toString().trim().split('\n');
  } catch {
    return [];
  }
}
