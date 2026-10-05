import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { $, quote, ProcessRunner } from '../src/$.mjs';

const fixture = fileURLToPath(
  new URL('./fixtures/chunked-output.mjs', import.meta.url)
);

export async function compareOutputModes({
  chunks = 8,
  bytes = 65536,
  delay = 5,
} = {}) {
  const args = [
    '--max-old-space-size=128',
    fixture,
    String(chunks),
    String(bytes),
    String(delay),
  ];
  const expected = chunks * bytes;
  const observations = [];
  for (const mode of [
    'ShellJS buffered',
    'command-stream buffered',
    'command-stream streaming',
  ]) {
    const started = performance.now();
    let firstByteMs;
    let received = 0;
    let code;
    if (mode === 'ShellJS buffered') {
      const command = [process.execPath, ...args].map(quote).join(' ');
      const result = $.shelljs.exec(command, {
        silent: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      received = Buffer.byteLength(result.stdout);
      code = result.code;
      firstByteMs = performance.now() - started;
    } else {
      const runner = new ProcessRunner(
        { mode: 'exec', file: process.execPath, args },
        { capture: mode.endsWith('buffered'), mirror: false, stdin: 'ignore' }
      );
      if (mode.endsWith('buffered')) {
        const result = await runner.start();
        received = result.stdout.length;
        code = result.code;
        firstByteMs = performance.now() - started;
      } else {
        for await (const chunk of runner.stream()) {
          if (chunk.type === 'stdout') {
            firstByteMs ??= performance.now() - started;
            received += chunk.data.length;
          } else if (chunk.type === 'exit') {
            code = chunk.code;
          }
        }
      }
    }
    if (received !== expected || code !== 0) {
      throw new Error(
        `${mode}: received ${received}/${expected} bytes, code ${code}`
      );
    }
    observations.push({
      mode,
      received,
      code,
      firstByteMs,
      totalMs: performance.now() - started,
    });
  }
  return {
    runtime: process.version,
    platform: process.platform,
    workload: { chunks, bytes, delay },
    observations,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(await compareOutputModes(), null, 2));
}
