// Besides the template tag there are plain functions: sh, exec, run and create.
import { $, sh, exec, run, create } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'function-api', title: 'sh(), exec(), run() and create()' },
  async ({ record }) => {
    record('sh(command)', (await sh('echo from-sh', { mirror: false })).stdout);
    record(
      'exec(file, args)',
      (await exec('echo', ['from-exec'], { mirror: false })).stdout
    );
    record('run(command)', (await run('echo from-run')).stdout);

    // create() returns a $ with preset options.
    const $quiet = create({ mirror: false, capture: true });
    record('create(options)', (await $quiet`echo from-create`).stdout);

    // $ itself can be called with options for the same effect.
    record('$(options)', (await $({ mirror: false })`echo from-dollar`).stdout);
  }
);
