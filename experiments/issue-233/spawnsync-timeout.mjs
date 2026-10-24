// What do Bun.spawnSync and child_process.spawnSync report on timeout?
import cp from 'node:child_process';
if (typeof Bun !== 'undefined') {
  const t = Date.now();
  const p = Bun.spawnSync(['sleep', '3'], {
    timeout: 200,
    killSignal: 'SIGTERM',
  });
  console.log('Bun', {
    ms: Date.now() - t,
    exitCode: p.exitCode,
    signalCode: p.signalCode,
    exitedDueToTimeout: p.exitedDueToTimeout,
  });
}
const t = Date.now();
const p = cp.spawnSync('sleep', ['3'], {
  timeout: 200,
  killSignal: 'SIGINT',
  encoding: 'utf8',
});
console.log('cp', {
  ms: Date.now() - t,
  status: p.status,
  signal: p.signal,
  error: p.error?.code,
});
