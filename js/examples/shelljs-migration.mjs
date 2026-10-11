import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, shelljs, register, unregister } from '../src/$.mjs';

const directory = await mkdtemp(join(tmpdir(), 'shelljs-migration-'));
const input = join(directory, 'log with spaces.txt');
const originalConfig = { ...shelljs.config };
try {
  await writeFile(input, 'WARN disk\nINFO ready\nWARN disk\n');
  shelljs.config.silent = true;
  console.log(shelljs.head({ '-n': 2 }, input).stdout);
  console.log(shelljs.cat(input).sort().uniq('-c').stdout);
  register('warnings', ({ stdin }) => ({
    code: 0,
    stdout: stdin
      .split('\n')
      .filter((line) => line.startsWith('WARN'))
      .join('\n'),
    stderr: '',
  }));
  const result = await $({
    mirror: false,
  })`cat ${input} | warnings | sort | uniq -c`;
  console.log(result.stdout.toString());
} finally {
  unregister('warnings');
  Object.assign(shelljs.config, originalConfig);
  await rm(directory, { recursive: true, force: true });
}
