// Oracle check for the JS lexer/parser/template port: Bun parses the script
// synchronously inside `$`, so for every corpus case compare whether (and
// with which message) `Bun.$` throws against the port's buildShellSource+parse.
// Run with: bun experiments/issue-27/bun-shell-parse-diff.mjs [--verbose]
import os from 'node:os';
import { allCases, materialize } from '../../conformance/bun-shell/corpus.mjs';
import { buildShellSource } from '../../js/src/bun-shell/template.mjs';
import { parse } from '../../js/src/bun-shell/parser.mjs';

const verbose = process.argv.includes('--verbose');
const tempDir = os.tmpdir();
let total = 0;
let fail = 0;
const outcome = (f) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return `ERR ${e.message}`;
  }
};
for (const c of allCases()) {
  let m;
  try {
    m = materialize(c, { tempDir, node: process.execPath });
  } catch {
    continue;
  }
  total++;
  const want = outcome(() => Bun.$(m.strings, ...m.values));
  const got = outcome(() => {
    const src = buildShellSource(m.strings.raw, m.values);
    parse(src.script, src.jsstrings, src.jsobjs.length);
  });
  if (want !== got) {
    fail++;
    console.log(
      `MISMATCH ${c.id}\n  script: ${JSON.stringify(m.strings.raw)}\n  bun : ${want.slice(0, 300)}\n  port: ${got.slice(0, 300)}`
    );
  } else if (verbose) {
    console.log(`ok ${c.id}: ${want.slice(0, 100)}`);
  }
}
console.log(`${total} cases, ${fail} mismatches`);
