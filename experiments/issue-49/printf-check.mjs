import { $ } from "../../js/src/$.mjs";
const v = 'price is $5 and "q"';
const strings = Object.assign(['printf "%s\\n" "', '"'], {
  raw: ['printf "%s\\n" "', '"'],
});
const r = await $(strings, v).run({ capture: true, mirror: false });
console.log(JSON.stringify(r.stdout));
const r2 = await $`printf "%s\n" "plain value"`.run({
  capture: true,
  mirror: false,
});
console.log(JSON.stringify(r2.stdout));
