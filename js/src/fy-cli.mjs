#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fy } from './fy.mjs';
import { basename } from 'node:path';

export async function fyCli(args = process.argv.slice(2)) {
  const [file, output] = args;
  if (!file || args.length > 2) {
    throw new Error('Usage: $fy input.sh [output.mjs]');
  }
  const source = await readFile(file, 'utf8');
  const shell =
    source.match(
      /^#!\s*(?:\/usr\/bin\/env\s+)?(?:.*\/)?(bash|dash|sh|zsh)\s*$/m
    )?.[1] ?? 'sh';
  const result = fy(source, { shell, name: basename(file) });
  if (output) {
    await writeFile(output, result, { mode: 0o755, flag: 'wx' });
  } else {
    process.stdout.write(result);
  }
}

if (
  import.meta.main ||
  process.argv[1]?.replaceAll('\\', '/').endsWith('/fy-cli.mjs')
) {
  fyCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
