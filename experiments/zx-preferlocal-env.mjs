// Inspect what `preferLocal` + a bare env produces for $PATH.
import { $ } from '../js/src/zx/core.mjs';
const o = await $({
  preferLocal: true,
  env: { PATH: process.env.PATH },
})`echo $PATH`.nothrow();
console.log(
  JSON.stringify(o.stdout.slice(0, 200)),
  JSON.stringify(o.stderr.slice(0, 300))
);
console.log($.shell, JSON.stringify($.prefix));
