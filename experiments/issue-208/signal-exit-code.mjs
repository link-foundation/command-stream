// Run with Node or Bun on POSIX systems. Each shell only signals itself.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { ProcessRunner } from '../../js/src/process-runner.mjs';

if (process.platform === 'win32') {
  console.log('POSIX signal reproduction skipped on Windows');
} else {
  for (const command of ['kill -TERM $$', 'kill -KILL $$', 'exit 3']) {
    const reference = await new Promise((resolve, reject) => {
      const child = spawn(command, { shell: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const spec = { mode: 'shell', file: command, args: [] };
    const options = { mirror: false, capture: true, stdin: 'ignore' };
    const asyncResult = await new ProcessRunner(spec, options);
    const syncResult = new ProcessRunner(spec, options).sync();
    const syncReference = spawnSync(command, { shell: true });
    console.log(
      JSON.stringify({
        command,
        async: { code: asyncResult.code, signal: asyncResult.signal },
        sync: { code: syncResult.code, signal: syncResult.signal },
        reference,
        syncReference: {
          code: syncReference.status,
          signal: syncReference.signal,
        },
      })
    );
  }
  // Make this a failing regression probe as well as a printable reproduction.
  const result = await new ProcessRunner(
    { mode: 'shell', file: 'kill -KILL $$', args: [] },
    { mirror: false, stdin: 'ignore' }
  );
  assert.equal(result.code, 137);
  assert.equal(result.signal, 'SIGKILL');
}
