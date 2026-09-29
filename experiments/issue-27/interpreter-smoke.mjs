// Smoke test for the Bun Shell interpreter: run a few scripts and print the
// captured result. Usage: node experiments/issue-27/interpreter-smoke.mjs
import { Interpreter } from '../../js/src/bun-shell/interpreter.mjs';
import { parse } from '../../js/src/bun-shell/parser.mjs';
import { buildShellSource } from '../../js/src/bun-shell/template.mjs';

async function sh(strings, ...values) {
  const { script, jsobjs, jsstrings } = buildShellSource(strings.raw, values);
  const ast = parse(script, jsstrings, jsobjs.length);
  const interp = new Interpreter({ jsobjs, env: process.env, quiet: true });
  const r = await interp.run(ast);
  return {
    exitCode: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  };
}

const buf = new Uint8Array(16);
const cases = [
  () => sh`echo hi | cat`,
  () => sh`echo one && echo two || echo three`,
  () => sh`false || echo fallback; echo $?`,
  () => sh`FOO=bar; echo $FOO`,
  () => sh`echo $(echo sub) "quoted $(echo x y)"`,
  () => sh`nonexistent-cmd-xyz`,
  () => sh`printf 'a\nb\nc\n' | grep b | wc -l`,
  () => sh`seq 1 5 | head -n 2`,
  () => sh`yes | head -n 3`,
  () => sh`if [[ -d /tmp ]]; then echo dir; else echo nodir; fi`,
  () => sh`(cd /tmp && pwd); pwd`,
  () => sh`echo err 1>&2`,
  () => sh`ls /nonexistent 2>&1`,
  () => sh`sh -c 'echo out; echo err >&2' 2>&1`,
  async () => {
    const r = await sh`echo buffered > ${buf}`;
    return { ...r, buf: Buffer.from(buf).toString() };
  },
  () => sh`cat < ${Buffer.from('from buffer\n')}`,
  () => sh`echo {a,b}{1,2}`,
  () => sh`echo ~ | wc -c`,
  () => sh`sh -c 'exit 3'; echo $?`,
];
for (const c of cases) {
  try {
    console.log(c.toString().slice(6, 80), '=>', JSON.stringify(await c()));
  } catch (e) {
    console.log(c.toString().slice(6, 80), '=> THROW', e);
  }
}
