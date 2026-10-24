// Through command-stream: does `env: { NAME: undefined }` remove NAME?
import { $ } from '../../js/src/$.mjs';
process.env.ENV_UNDEFINED_PROBE = 'inherited';
const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';
const env = { ...process.env, ENV_UNDEFINED_PROBE: undefined };
const shell = await $({
  env,
  mirror: false,
})`sh -c 'echo "\${ENV_UNDEFINED_PROBE-unset}"'`;
console.log(runtime, 'shell string', JSON.stringify(shell.stdout.trim()));
const sync = $({
  env,
  mirror: false,
})`sh -c 'echo "\${ENV_UNDEFINED_PROBE-unset}"'`.sync();
console.log(runtime, 'sync', JSON.stringify(sync.stdout.trim()));
const virt = await $({ env, mirror: false })`env`;
console.log(
  runtime,
  'virtual env',
  virt.stdout.includes('ENV_UNDEFINED_PROBE')
);
const partial = await $({
  env: { ENV_UNDEFINED_PROBE: undefined, ADDED: 'x' },
  mirror: false,
})`sh -c 'echo "\${ENV_UNDEFINED_PROBE-unset} \${PATH:+haspath} $ADDED"'`;
console.log(runtime, 'partial env', JSON.stringify(partial.stdout.trim()));
