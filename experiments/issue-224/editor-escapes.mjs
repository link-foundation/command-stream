// Bound the editor regexp probe to a 16 MiB worker and a finite watchdog.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const module = fileURLToPath(
  new URL(
    '../../extensions/vscode-command-stream/src/extension.cjs',
    import.meta.url
  )
);
const worker = new Worker(
  `const {parentPort, workerData} = require('node:worker_threads');
   const {shellErrors} = require(workerData.module);
   parentPort.postMessage('ready');
   const errors = shellErrors({getText: () => '$\u0060' + '\\\\_'.repeat(32)});
   parentPort.postMessage(errors);`,
  {
    eval: true,
    workerData: { module },
    resourceLimits: { maxOldGenerationSizeMb: 16, stackSizeMb: 1 },
  }
);
let watchdog;
try {
  const result = await new Promise((resolve, reject) => {
    worker.on('message', (message) => {
      if (message === 'ready') {
        watchdog = setTimeout(
          () => reject(new Error('Editor diagnostics stalled')),
          500
        );
      } else {
        resolve(message);
      }
    });
    worker.on('error', reject);
  });
  assert.deepEqual(result, []);
  console.log('editor escape scan completed');
} finally {
  clearTimeout(watchdog);
  await worker.terminate();
}
