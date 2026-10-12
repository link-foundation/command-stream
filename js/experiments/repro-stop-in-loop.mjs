import { $ } from '../src/$.mjs';

// Feature: stop the process from inside the stream() loop.
// A long-running producer keeps emitting lines; we stop after 3.

console.log('--- kill() inside the loop ---');
{
  const start = Date.now();
  const cmd = $({
    mirror: false,
  })`sh -c 'i=0; while true; do i=$((i+1)); echo line-$i; sleep 0.05; done'`;
  let count = 0;
  const seen = [];
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      count += chunk.data.toString().split('\n').filter(Boolean).length;
      seen.push(chunk.data.toString().trim());
      if (count >= 3) {
        cmd.kill(); // stop the process from inside the loop
      }
    } else if (chunk.type === 'exit') {
      seen.push('EXIT code=' + chunk.code);
    }
  }
  console.log(
    'elapsed',
    Date.now() - start,
    'ms; chunks:',
    JSON.stringify(seen)
  );
}

console.log('--- break inside the loop ---');
{
  const start = Date.now();
  const cmd = $({
    mirror: false,
  })`sh -c 'i=0; while true; do i=$((i+1)); echo b-$i; sleep 0.05; done'`;
  let count = 0;
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      count += 1;
      if (count >= 3) {
        break;
      }
    }
  }
  console.log(
    'elapsed',
    Date.now() - start,
    'ms; finished?',
    cmd.finished,
    'code',
    cmd.result?.code
  );
}

console.log('--- normal command timing (should NOT add ~100ms) ---');
{
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    for await (const chunk of $({ mirror: false })`echo quick`.stream()) {
      void chunk;
    }
    samples.push(Date.now() - t);
  }
  console.log('elapsed samples ms:', JSON.stringify(samples));
}

process.exit(0);
