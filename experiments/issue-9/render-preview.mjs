// Render the actual exported SVG with its embedded font; no browser required.
import { Resvg } from '../../js/node_modules/@resvg/resvg-js/index.js';
import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL(
  '../../js/docs/screenshots/terminal-changes/',
  import.meta.url
);
const svg = await readFile(new URL('snapshot.svg', directory), 'utf8');
const png = new Resvg(svg).render().asPng();
await writeFile(new URL('snapshot.png', directory), png);
