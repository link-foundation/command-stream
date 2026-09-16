import { $ } from '../src/$.mjs';

// Compare grace settings in the grandchild-holds-pipe case.
for (const grace of [0, 50, 100, 200]) {
  const start = Date.now();
  const cmd = $({
    mirror: false,
    exitPumpGrace: grace,
  })`sh -c 'sleep 5 & echo done'`;
  const out = [];
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      out.push(chunk.data.toString().trim());
    }
    if (chunk.type === 'exit') {
      out.push('exit=' + chunk.code);
    }
  }
  console.log(
    `grace=${grace}ms -> elapsed ${Date.now() - start}ms, captured ${JSON.stringify(out)}`
  );
  cmd.kill('SIGKILL');
}
process.exit(0);
