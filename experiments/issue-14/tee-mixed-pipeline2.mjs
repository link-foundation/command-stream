import { $ } from '../../js/src/$.mjs';

const f = '/tmp/tee-probe-a.txt';
console.log(
  '1:',
  JSON.stringify(
    (await $({ mirror: false })`echo hello | tee ${f} | tr a-z A-Z`).stdout
  )
);
console.log(
  '2:',
  JSON.stringify(
    (await $({ mirror: false })`echo hello | cat | tr a-z A-Z`).stdout
  )
);
console.log(
  '3:',
  JSON.stringify((await $({ mirror: false })`echo hello | tee ${f}`).stdout)
);
console.log(
  '4:',
  JSON.stringify((await $`echo hello | tee ${f} | tr a-z A-Z`).stdout)
);
console.log(
  '5:',
  JSON.stringify((await $`echo hello | cat | tr a-z A-Z`).stdout)
);
