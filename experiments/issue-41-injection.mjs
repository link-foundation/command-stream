import { $ } from '../js/src/$.mjs';
const evil = `"' ; touch /tmp/pwned-41b ; '"`;
const c = $({ mirror: false })`printf ${{ raw: '"[%s]\\n"' }} ${evil}`;
console.log('built=', JSON.stringify(c.spec.command));
const r = await c;
console.log('code', r.code, JSON.stringify(r.stdout), JSON.stringify(r.stderr));
