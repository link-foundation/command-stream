// Probe issue 216 F2: after command-stream's kill(), how long does a trapped
// sh take to run its handler, and does SIGKILL escalation (default 100 ms
// grace) cut the handler off? kill() resolves the command immediately, so the
// marker file is polled instead of relying on `await cmd`.
// Usage: bun experiments/issue-216/signal-handler-latency.mjs [shell] [runs] [killGrace] [waitForReady]
import { $ } from '../../js/src/$.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [shell = 'sh', runs = '40', grace = '100', waitReady = 'no'] =
  process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dir = mkdtempSync(join(tmpdir(), 'cs-latency-'));
const handled = (marker) =>
  existsSync(marker) && readFileSync(marker, 'utf8').includes('handled');
const latencies = [];
let missing = 0;
let notReady = 0;
for (let i = 0; i < Number(runs); i++) {
  const marker = join(dir, `marker-${i}`);
  const script = `trap 'echo handled >> ${marker}; exit 0' INT; echo ready; while true; do sleep 0.05; done`;
  const cmd = $({
    mirror: false,
    killSignal: 'SIGINT',
    killGrace: Number(grace),
  })`${shell} -c ${script}`;
  let ready = false;
  cmd.on('stdout', (chunk) => {
    if (String(chunk).includes('ready')) {
      ready = true;
    }
  });
  cmd.start();
  if (waitReady === 'yes') {
    for (let waited = 0; !ready && waited < 10000; waited += 5) {
      await sleep(5);
    }
  } else {
    await sleep(300);
  }
  if (!ready) {
    notReady++;
  }
  const started = globalThis.performance.now();
  cmd.kill();
  await cmd;
  while (!handled(marker) && globalThis.performance.now() - started < 3000) {
    await sleep(2);
  }
  if (handled(marker)) {
    latencies.push(globalThis.performance.now() - started);
  } else {
    missing++;
  }
}
rmSync(dir, { recursive: true, force: true });
latencies.sort((a, b) => a - b);
const pct = (p) =>
  latencies.length
    ? latencies[
        Math.min(latencies.length - 1, Math.floor(p * latencies.length))
      ].toFixed(1)
    : 'n/a';
console.log(
  JSON.stringify({
    shell,
    runs: Number(runs),
    killGrace: Number(grace),
    waitForReady: waitReady,
    notReadyAtKill: notReady,
    handlerMissing: missing,
    p50: pct(0.5),
    p90: pct(0.9),
    max: pct(1),
  })
);
