// Probes the environment built-ins one by one, printing before/after each step,
// so a hanging step is obvious.
import { $ } from '../js/src/$.mjs';

const $q = $({ mirror: false });
const step = async (label, fn) => {
  process.stdout.write(`-> ${label} ... `);
  try {
    console.log(JSON.stringify(await fn()));
  } catch (e) {
    console.log(`ERROR ${e.message}`);
  }
};

await step('pwd', async () => (await $q`pwd`).stdout);
await step('cd /tmp', async () => (await $q`cd /tmp`).code);
await step('pwd after cd', async () => (await $q`pwd`).stdout);
await step(
  'env with custom env',
  async () => (await $({ mirror: false, env: { DEMO: 'value' } })`env`).stdout
);
await step('which sh', async () => (await $q`which sh`).code);
await step('sleep 0.1', async () => (await $q`sleep 0.1`).code);
