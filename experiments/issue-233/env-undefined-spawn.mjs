// Does child_process.spawn drop env entries whose value is undefined?
import { spawnSync } from 'node:child_process';
process.env.ENV_UNDEFINED_PROBE = 'inherited';
const env = { ...process.env, ENV_UNDEFINED_PROBE: undefined };
const out = spawnSync(
  '/bin/sh',
  ['-c', 'echo "${ENV_UNDEFINED_PROBE-unset}"'],
  { env, encoding: 'utf8' }
);
console.log(
  typeof Bun !== 'undefined' ? 'bun' : 'node',
  JSON.stringify(out.stdout.trim())
);
