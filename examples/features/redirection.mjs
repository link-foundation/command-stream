// Output and input redirection work with built-ins and with your own commands,
// without handing the command line to a real shell.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import fs from 'fs';
import path from 'path';

await example({ id: 'redirection', title: 'Redirecting output and input' }, async ({ record }) => {
  const dir = makeTempDir('redirect');
  const file = path.join(dir, 'out.txt');
  const $q = $({ mirror: false });

  const written = await $q`echo first > ${file}`;
  record('the command itself prints nothing', written.stdout);
  record('the file holds the output', fs.readFileSync(file, 'utf8'));

  await $q`echo second >> ${file}`;
  record('>> appends', fs.readFileSync(file, 'utf8'));

  const numbers = path.join(dir, 'numbers.txt');
  await $q`seq 1 3 | cat > ${numbers}`;
  record('a pipeline can redirect too', fs.readFileSync(numbers, 'utf8'));

  record('< feeds a command from a file', (await $q`cat < ${file}`).stdout);
  record('a quoted > stays a literal argument', (await $q`echo "a > b"`).stdout);
});
