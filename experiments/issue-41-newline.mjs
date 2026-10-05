import { $ } from '../js/src/$.mjs';
import { fileURLToPath } from 'node:url';
const P = fileURLToPath(
  new URL('../js/tests/fixtures/argprint.mjs', import.meta.url)
);
const v = '/tmp/new\nline/f.txt';
for (const build of [
  () => $({ mirror: false })`node ${P} ${v}`,
  () => $({ mirror: false })`printf "[%s]\n" ${v}`,
]) {
  const c = build();
  console.log('BUILT', JSON.stringify(c.spec.command));
  const r = await c;
  console.log(
    '  code',
    r.code,
    'out',
    JSON.stringify(r.stdout),
    'err',
    JSON.stringify(r.stderr)
  );
}
