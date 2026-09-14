import { $ } from '../js/src/$.mjs';
const filePath = '/tmp/space test dir/report file.txt';
const cmd = $({ mirror: false })`sh -c "cat \"${filePath}\""`;
console.log('BUILT:', JSON.stringify(cmd.spec.command));
const r = await cmd;
console.log('code', r.code, JSON.stringify(r.stdout), JSON.stringify(r.stderr));
