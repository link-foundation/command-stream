// $({ ... }) configures capture, mirroring, cwd, env and stdin.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import path from 'path';
import fs from 'fs';

await example(
  { id: 'options', title: 'Options: capture, cwd, env, stdin' },
  async ({ record }) => {
    const dir = makeTempDir('options');
    fs.writeFileSync(path.join(dir, 'marker.txt'), 'here\n');

    record(
      'captured output',
      (await $({ mirror: false, capture: true })`echo captured`).stdout
    );
    record(
      'capture disabled',
      (await $({ mirror: false, capture: false })`echo dropped`).stdout
    );

    const inDir = await $({ mirror: false, cwd: dir })`ls`;
    record('cwd option', inDir.stdout);

    const withEnv = await $({
      mirror: false,
      env: { ...process.env, DEMO_VALUE: 'from-env' },
    })`printenv DEMO_VALUE`;
    record('env option', withEnv.stdout);

    const withStdin = await $({ mirror: false, stdin: 'piped in\n' })`cat`;
    record('stdin option', withStdin.stdout);
  }
);
