// Probes how zx, execa and ShellJS express timeout, env removal and detached spawn,
// so the feature catalog's alternatives are accurate.
import { createRequire } from 'module';
const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { $ } = await import(require.resolve('zx'));
const { execa } = await import(require.resolve('execa'));
const shell = require('shelljs');
$.verbose = false;

const zxTimeout = await $({ timeout: '200ms', nothrow: true })`sleep 5`;
console.log('zx timeout', zxTimeout.exitCode, zxTimeout.signal);
try {
  await execa({ timeout: 200 })`sleep 5`;
} catch (e) {
  console.log('execa timeout', e.timedOut);
}
const sh = shell.exec('sleep 5', { silent: true, timeout: 200 });
console.log('shelljs sync timeout code', sh.code);
process.env.PROBE_DROP = 'x';
const zxEnv = await $({
  env: { ...process.env, PROBE_DROP: undefined },
  nothrow: true,
})`printenv PROBE_DROP`;
console.log('zx env undefined', zxEnv.exitCode);
const execaEnv = await execa({
  env: { PROBE_DROP: undefined },
  reject: false,
})`printenv PROBE_DROP`;
console.log('execa env undefined (extendEnv)', execaEnv.exitCode);
const execaDet = execa({ detached: true, stdio: 'ignore' })`sleep 0.1`;
console.log('execa detached pid', typeof execaDet.pid);
execaDet.unref?.();
