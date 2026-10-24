// Rebuild the local compatibility source from the pinned development packages.
// Run from the repository root after installing js/ dependencies.
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const upstream = join(root, 'js/node_modules/shelljs');
const vendor = join(root, 'js/src/shelljs/vendor');
mkdirSync(join(vendor, 'src'), { recursive: true });
for (const name of [
  'shell.js',
  'plugin.js',
  ...readdirSync(join(upstream, 'src')).map((name) => `src/${name}`),
]) {
  let source = readFileSync(join(upstream, name), 'utf8');
  source = source.replace("require('fast-glob')", "require('../../glob.cjs')");
  source = source.replace(
    "var execa = require('execa');",
    "var execa = { sync: require('../../runtime.cjs').execaSync };"
  );
  writeFileSync(join(vendor, name), source);
}
writeFileSync(
  join(vendor, 'package.json'),
  '{"private":true,"type":"commonjs"}\n'
);
copyFileSync(join(upstream, 'LICENSE'), join(vendor, 'LICENSE'));
const types = join(root, 'js/node_modules/@types/shelljs');
const declarations = readFileSync(join(types, 'index.d.ts'), 'utf8')
  .replace(
    'import glob = require("fast-glob");',
    'import type { GlobOptions } from "./zx-api.cjs";'
  )
  .replace(
    'globOptions: glob.Options;',
    'globOptions: GlobOptions & { globstar?: boolean; concurrency?: number };'
  );
writeFileSync(join(root, 'js/types/shelljs-upstream.d.cts'), declarations);
copyFileSync(join(types, 'LICENSE'), join(root, 'js/types/SHELLJS-LICENSE'));
