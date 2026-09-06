import { $ } from '../js/src/$.mjs';
for (const v of [`"it's"`, `''`, `'; touch /tmp/pwned-41; '`]) {
  const c = $({ mirror: false })`printf ${{ raw: '"[%s]\\n"' }} ${v}`;
  console.log(JSON.stringify(v), 'built=', JSON.stringify(c.spec.command));
  try {
    const r = await c;
    console.log(
      '   out=',
      JSON.stringify(r.stdout),
      'code=',
      r.code,
      'err=',
      JSON.stringify(r.stderr.slice(0, 80))
    );
  } catch (e) {
    console.log('   THREW', e.message);
  }
}
