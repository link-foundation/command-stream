import { $ } from "../../js/src/$.mjs";

const cmd = 'for file in a.js b.js; do echo "Processing: $file"; done';
const r = await $`bash -c "${cmd}"`.run({ capture: true, mirror: false });
console.log("exit:", r.code);
console.log("stdout:", JSON.stringify(r.stdout));
console.log("stderr:", JSON.stringify(r.stderr));
