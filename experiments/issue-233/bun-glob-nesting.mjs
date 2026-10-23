// Bun.Glob behaviour for deeply nested braces differs between Bun releases;
// run with each Bun binary to compare (CI's `bun-version: latest` moved to 1.4.4).
import { globMatch } from '../../js/src/bun-shell/glob.mjs';
for (const depth of [1, 8, 10, 11, 12, 16, 32, 64, 200, 2000]) {
  const p = `${'{a,'.repeat(depth)}b${'}'.repeat(depth)}`;
  let bun;
  try {
    bun = new Bun.Glob(p).match('b');
  } catch (e) {
    bun = `throws ${e.message}`;
  }
  let ours;
  try {
    ours = globMatch(p, 'b');
  } catch (e) {
    ours = `throws ${e.message}`;
  }
  console.log(
    Bun.version,
    depth,
    'bun',
    bun,
    'ours',
    ours,
    'a?',
    new Bun.Glob(p).match('a')
  );
}
