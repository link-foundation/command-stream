// Run with Node or Bun to inspect a migrated automation script.
import { translateSource } from '../src/fy/index.mjs';

const source = `import { $ } from 'zx';
const branch = (await $\`git branch --show-current\`).text().trim();
console.log(branch);
`;
const translated = translateSource(source, { from: 'zx' });
process.stdout.write(translated.code);
for (const diagnostic of translated.diagnostics) {
  console.error(diagnostic);
}
