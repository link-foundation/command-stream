import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const assets = new URL('../src/assets/', import.meta.url);
const source = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf');
const license = new URL(
  './LICENSE',
  import.meta.resolve('dejavu-fonts-ttf/package.json')
);

const ranges = [
  [0x20, 0x7e], // Basic Latin
  [0xa0, 0x24f], // Latin-1 and Latin Extended
  [0x2190, 0x21ff], // Arrows
  [0x2800, 0x28ff], // Braille patterns
];
const characters = ranges
  .flatMap(([start, end]) =>
    Array.from({ length: end - start + 1 }, (_, offset) =>
      String.fromCodePoint(start + offset)
    )
  )
  .join('');

await mkdir(assets, { recursive: true });
const font = await subsetFont(await readFile(source), characters, {
  targetFormat: 'woff2',
});
const licenseText = (await readFile(license, 'utf8')).replaceAll(
  /[ \t]+$/gm,
  ''
);
await Promise.all([
  writeFile(new URL('dejavu-sans-mono-terminal.woff2', assets), font),
  writeFile(new URL('DejaVu-Fonts-LICENSE.txt', assets), licenseText),
]);
