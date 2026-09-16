import { $ } from '../../js/src/$.mjs';
const v = 'price is $5 and "q" and `tick` and back\\slash';
for (const cmd of ['echo', '/bin/echo', 'printf "%s\\n"']) {
  const strings = Object.assign([`${cmd} "`, '"'], { raw: [`${cmd} "`, '"'] });
  const r = await $(strings, v).run({ capture: true, mirror: false });
  console.log(cmd.padEnd(16), JSON.stringify(r.stdout));
}
