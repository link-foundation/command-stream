// Regenerate byte-exact outputs after an intentional translation rule change.
import { readFileSync, writeFileSync } from 'node:fs';
import { translateSource } from '../src/fy/index.mjs';

for (const [input, output] of [
  ['sample.sh', 'sample-program.mjs'],
  ['competitors.js', 'competitors.mjs'],
  ['commonjs.cjs', 'commonjs.mjs'],
]) {
  const source = readFileSync(
    new URL(`../../fixtures/fy/${input}`, import.meta.url),
    'utf8'
  );
  writeFileSync(
    new URL(`../../fixtures/fy/${output}`, import.meta.url),
    translateSource(source, { filename: input }).code
  );
}
