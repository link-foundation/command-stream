// Finite comparison; run each mode in a fresh Node process with --max-old-space-size=128.
import { performance } from 'node:perf_hooks';
import { command } from '../../js/src/$.mjs';
const mode = process.argv[2] ?? 'stream';
const count = 100000;
const script = `for(let i=0;i<${count};i++){if(!process.stdout.write('x'.repeat(255)+'\\n')) await new Promise(resolve=>process.stdout.once('drain',resolve));}`;
const started = performance.now();
const baseline = process.memoryUsage().rss;
let peak = baseline;
const timer = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 5);
let lines = 0;
try {
  const builder = command(
    process.execPath,
    '--input-type=module',
    '-e',
    script
  ).with({ capture: mode === 'buffer', stdin: 'ignore' });
  if (mode === 'buffer') {
    const result = await builder;
    lines = String(result.stdout).trimEnd().split('\n').length;
  } else {
    await builder
      .stream({ highWaterMark: 2, highWaterBytes: 65536 })
      .forEach(() => {
        lines++;
      });
  }
  peak = Math.max(peak, process.memoryUsage().rss);
  console.log(
    JSON.stringify({
      mode,
      lines,
      bytes: count * 256,
      elapsedMs: performance.now() - started,
      baselineRss: baseline,
      peakRss: peak,
      rssGrowth: peak - baseline,
    })
  );
} finally {
  clearInterval(timer);
}
