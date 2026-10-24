// Is a variable set on process.env after startup inherited when no env is given?
// Observed: node prints `inherited`, bun 1.4.3 prints `unset` (Bun.spawn without
// `env` uses the environment captured at startup). Not changed by issue #233.
import { $ } from '../../js/src/$.mjs';
process.env.ENV_RUNTIME_PROBE = 'inherited';
const r = await $({
  mirror: false,
})`node -e "process.stdout.write(process.env.ENV_RUNTIME_PROBE ?? 'unset')"`;
console.log(typeof Bun !== 'undefined' ? 'bun' : 'node', String(r.stdout));
