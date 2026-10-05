// Does command-stream's JS kill() let a child handle the signal it was sent?
//
// The child traps SIGTERM/SIGINT and appends a line to a marker file. If the
// marker stays empty, the child never got to run its handler -- meaning the
// signal was immediately followed by an unsurvivable SIGKILL.
import { $ } from '../../js/src/$.mjs';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cs-signal-'));
const child = new URL('./graceful-child.sh', import.meta.url).pathname;

async function probe(signal) {
  const marker = join(dir, `marker-${signal}`);
  const cmd = $({ mirror: false })`sh ${child} ${marker}`;
  const running = cmd.start();
  await new Promise((r) => setTimeout(r, 400)); // let the trap install
  cmd.kill(signal);
  const result = await running;
  await new Promise((r) => setTimeout(r, 300)); // let the handler flush
  const handled = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
  return {
    signal,
    code: result.code,
    handled: handled || '(handler never ran)',
  };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  console.log(JSON.stringify(await probe(signal)));
}
