// An env value of undefined removes that variable from the child's environment.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'env-removal', title: 'Remove environment variables' },
  async ({ record }) => {
    const env = { ...process.env, DEMO_KEEP: 'kept', DEMO_DROP: 'dropped' };

    const kept = await $({ mirror: false, env })`printenv DEMO_KEEP`;
    record('kept variable', kept.stdout);

    // `env -u DEMO_DROP`: the variable is absent, not merely empty.
    const removed = await $({
      mirror: false,
      env: { ...env, DEMO_DROP: undefined },
    })`printenv DEMO_DROP`;
    record('removed variable exit code', removed.code);
  }
);
