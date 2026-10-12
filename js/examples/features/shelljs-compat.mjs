import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, shelljs } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';

await example(
  { id: 'shelljs-compat', title: 'ShellJS compatibility mode' },
  async ({ record }) => {
    shelljs.config.silent = true;
    const directory = makeTempDir('shelljs');
    const file = join(directory, 'file with spaces');
    writeFileSync(file, 'z\na\na\nb\n');
    record('general API', $.shelljs === shelljs);
    record('separate arguments', shelljs.echo('hello', 'two words').stdout);
    record('head', shelljs.head({ '-n': 2 }, file).stdout);
    record('tail', shelljs.tail('-n', '2', file).stdout);
    record('missing file code', shelljs.cat(join(directory, 'missing')).code);
    shelljs.config.reset();
  }
);
