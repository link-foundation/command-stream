// Reproduces the zx timeout()/kill() race: when the shell forks its command,
// signalling the descendants before the shell lets the shell report the
// child's death as exit code 143 instead of dying by the signal itself.
// Usage: node experiments/zx-timeout-kill-race.mjs [runs]
import { $ } from '../js/src/zx/index.mjs';

const runs = Number(process.argv[2] ?? 40);
const outcomes = {};
for (let i = 0; i < runs; i++) {
  let key = 'resolved';
  try {
    await $({ quiet: true })`sleep 5; :`.timeout(100);
  } catch (p) {
    key = `exitCode=${p.exitCode} signal=${p.signal}`;
  }
  outcomes[key] = (outcomes[key] ?? 0) + 1;
}
console.log(outcomes);
