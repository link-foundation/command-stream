// Mechanical first pass of porting a google/zx test file to command-stream
// (issue #26): tag each registered test with its competitor-ledger id and
// point imports at js/src/zx. The output is then adapted by hand.
//
// usage: node experiments/zx-port-tests.mjs <zx-test-file> <ids-file> <out>
import fs from 'node:fs';
import path from 'node:path';

const [src, idsFile, out] = process.argv.slice(2);
const rel = `test/${path.basename(src)}`;
const lines = fs.readFileSync(src, 'utf8').split('\n');
const ids = fs
  .readFileSync(idsFile, 'utf8')
  .split('\n')
  .map((l) => l.split(' | ')[0].trim())
  .filter((id) => id.startsWith(`zx:${rel}:`) && id.endsWith(':registration'));

let tagged = 0;
for (const id of ids) {
  const parts = id.split(':');
  const ln = +parts[2] - 1;
  const col = +parts[3] - 1;
  const line = lines[ln];
  const open = line.indexOf('(', col);
  const q = line[open + 1];
  if (!["'", '"', '`'].includes(q)) {
    console.error(`cannot tag ${id}: ${line.trim()}`);
    continue;
  }
  lines[ln] = `${line.slice(0, open + 2)}[${id}] ${line.slice(open + 2)}`;
  tagged++;
}

let text = lines.join('\n');
text = text.replace(
  /^\/\/ Copyright[\s\S]*?limitations under the License\.\n\n/,
  ''
);
text = text.replace(
  /from '\.\.\/(?:build|src)\/([\w-]+)\.(?:js|cjs|ts)'/g,
  "from '../../src/zx/$1.mjs'"
);
text = text.replace(
  /import '\.\.\/build\/([\w-]+)\.js'/g,
  "import '../../src/zx/$1.mjs'"
);
const header = `// Port of zx ${rel} (issue #26). Test vectors come from google/zx\n// (Apache-2.0) at the pinned corpus commit.\n\n`;
fs.writeFileSync(out, header + text.replace(/\)\n$/, ')\n'));
console.log(`${out}: tagged ${tagged}/${ids.length}`);
