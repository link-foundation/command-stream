// Run with Node.js or Bun from the repository root. The watchdog bounds the
// original hang without launching a child process when cancellation works.
import assert from 'node:assert/strict';
import { $ } from '../../js/src/$.mjs';
import { ProcessRunner } from '../../js/src/process-runner.mjs';

let currentCase;
const watchdog = setTimeout(() => {
  console.error(`BUG: ${currentCase} stream() is still pending`);
  process.exit(1);
}, 2000);

try {
  const options = { signal: AbortSignal.abort(), mirror: false };
  const cases = [
    ['template command', () => $(options)`sleep 5`],
    [
      'shell file/args runner',
      () =>
        new ProcessRunner(
          { mode: 'shell', file: 'sleep', args: ['5'] },
          options
        ),
    ],
  ];
  for (const [name, factory] of cases) {
    currentCase = name;
    const runner = factory();
    const chunks = [];
    for await (const chunk of runner.stream()) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks, [{ type: 'exit', code: 143 }]);
    assert.equal((await runner).code, 143);
    assert.equal(runner._child, null);
  }
  console.log('OK: both streams yielded exit code 143');
} finally {
  clearTimeout(watchdog);
}
