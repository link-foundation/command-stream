// Demonstrates that jscpd's `format` option names languages, not reporters:
// `"format": "console"` silently narrows the analysis to zero files.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jscpd = resolve(here, '..', '..', 'js', 'node_modules', '.bin', 'jscpd');

const work = mkdtempSync(join(tmpdir(), 'jscpd-format-'));
const duplicated = `export function alpha(list) {
  const out = [];
  for (const item of list) {
    if (item == null) continue;
    out.push(String(item).trim().toLowerCase());
  }
  return out;
}
`;
writeFileSync(join(work, 'a.mjs'), duplicated);
writeFileSync(join(work, 'b.mjs'), duplicated);

const base = {
  threshold: 0,
  minTokens: 30,
  minLines: 5,
  reporters: ['console'],
};

for (const [label, format] of [
  ['"format": "console"', 'console'],
  ['"format": ["javascript"]', ['javascript']],
]) {
  const configPath = join(
    work,
    `config-${Array.isArray(format) ? 'lang' : 'reporter'}.json`
  );
  writeFileSync(configPath, JSON.stringify({ ...base, format }));

  const result = spawnSync(jscpd, ['-c', configPath, work], {
    encoding: 'utf8',
  });
  const found = /Found (\d+) clones/.exec(result.stdout ?? '');

  console.log(`${label}`);
  console.log(`  exit code:      ${result.status}`);
  console.log(`  clones found:   ${found ? found[1] : 0}`);
  console.log(
    `  files analysed: ${/│ javascript/.test(result.stdout ?? '') ? 2 : 0}`
  );
}

console.log(
  '\nWith threshold 0 and two identical files, only the second configuration fails.'
);
