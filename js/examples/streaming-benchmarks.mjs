// Finite comparison with the same 16-line producer in all modes. Execa
// streaming is measured as well as buffering; results are observations.
import { performance } from 'node:perf_hooks';
import { $ } from '../src/$.mjs';
import { execa } from '../src/execa/index.mjs';

const script = `let i = 0; const timer = setInterval(() => {
  console.log('line ' + i++); if (i === 16) clearInterval(timer);
}, 10);`;

async function measure(name, mode) {
  const start = performance.now();
  let first;
  let bytes = 0;
  const note = (data) => {
    first ??= performance.now() - start;
    bytes += Buffer.byteLength(data);
  };
  if (mode === 'native') {
    for await (const chunk of $({
      mirror: false,
      capture: false,
    })`${process.execPath} -e ${script}`.stream()) {
      if (chunk.type === 'stdout') {
        note(chunk.data);
      }
    }
  } else if (mode === 'stream') {
    const child = execa(process.execPath, ['-e', script], { buffer: false });
    for await (const chunk of child.stdout) {
      note(chunk);
    }
    await child;
  } else {
    note(
      (
        await execa(process.execPath, ['-e', script], {
          stripFinalNewline: false,
        })
      ).stdout
    );
  }
  const total = performance.now() - start;
  return {
    name,
    firstOutputMs: Number(first.toFixed(2)),
    totalMs: Number(total.toFixed(2)),
    bytes,
    streamedBeforeCompletion: mode !== 'buffer' && first < total,
  };
}

console.log(
  JSON.stringify(
    await Promise.all([
      measure('command-stream typed chunks', 'native'),
      measure('Execa readable stream', 'stream'),
      measure('Execa buffered result', 'buffer'),
    ]),
    null,
    2
  )
);
