import { $ } from '../src/$.mjs';
process.chdir('/tmp');
let r = await $`echo $HOME`;
console.log('virtual echo $HOME ->', JSON.stringify(r.stdout.toString().trim()));
r = await $`/bin/echo $HOME`;
console.log('/bin/echo $HOME ->', JSON.stringify(r.stdout.toString().trim()));
r = await $`/bin/echo hi && /bin/echo $HOME`;
console.log('chained /bin/echo $HOME ->', JSON.stringify(r.stdout.toString().trim()));
