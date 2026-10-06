// Isolated mock of Bun's macOS child_process.spawnSync signal reports.
// No real child receives a signal; run this finite probe under Node or Bun.
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import os from 'node:os';

Object.defineProperty(process, 'platform', { value: 'darwin' });
os.constants.signals = { SIGTERM: 15, SIGSYS: 12, SIGUSR1: 30, SIGUSR2: 31 };
if (!globalThis.Bun) {
  globalThis.Bun = {};
}
globalThis.Bun.spawnSync = () => ({ signalCode: 'SIGPWR' });

let reportedSignal;
cp.spawnSync = (_file, _args, options) => {
  assert.equal(options.shell, true);
  return {
    pid: 123,
    status: reportedSignal ? null : 3,
    signal: reportedSignal,
    stdout: '',
    stderr: '',
  };
};

// Import after selecting Bun's runtime path, including when probing with Node.
const { ProcessRunner } = await import('../../js/src/process-runner.mjs');
for (const [raw, signal, code] of [
  ['SIGPWR', 'SIGUSR1', 158],
  ['SIGSYS', 'SIGUSR2', 159],
  [null, null, 3],
]) {
  reportedSignal = raw;
  const result = new ProcessRunner(
    { mode: 'shell', file: 'mock-child', args: [] },
    { mirror: false, stdin: 'ignore' }
  ).sync();
  assert.equal(result.code, code);
  assert.equal(result.signal, signal);
}
console.log('OK: Bun Darwin Node-compatible sync statuses preserve signals');
