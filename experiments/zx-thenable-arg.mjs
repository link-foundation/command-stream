// Does a rejected thenable argument surface as a ProcessOutput (zx semantics)?
import { $, ProcessOutput } from '../js/src/zx/core.mjs';
process.on('unhandledRejection', (e) => console.log('UNHANDLED', e));
const a3 = new Promise((_, rej) => setTimeout(rej, 20, 'failure'));
await new Promise((r) => setTimeout(r, 5));
try {
  await $`echo ${a3}`;
} catch (e) {
  console.log(e instanceof ProcessOutput, e.exitCode, e.cause);
}
