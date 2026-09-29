// mirror controls whether output is shown, capture whether it is kept.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'mirror-capture', title: 'Mirroring and capturing output' },
  async ({ record }) => {
    // The default: output is shown and captured.
    const both = await $`echo shown and captured`;
    record('default mirror', true);
    record('default capture', both.stdout);

    const quiet = await $({ mirror: false })`echo only captured`;
    record('mirror: false still captures', quiet.stdout);

    const dropped = await $({ mirror: false, capture: false })`echo neither`;
    record('capture: false returns no stdout', dropped.stdout);
  }
);
