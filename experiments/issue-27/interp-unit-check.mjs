// Cross-checks expectations of the Rust interpreter unit tests against the
// JS port. Run: node experiments/issue-27/interp-unit-check.mjs
import { $ } from '../../js/src/bun-shell/shell.mjs';

const env = {
  PATH: process.env.PATH,
  HOME: '/home/me',
  GREETING: 'hello world',
};
const scripts = [
  'echo $GREETING',
  'echo "[$GREETING]" $GREETING',
  'exit 7; echo unreachable',
  'echo a; exit 7; echo b',
  'exit 7 && echo b',
  'false; true',
];
for (const s of scripts) {
  try {
    const o = await $`${{ raw: s }}`.env(env).quiet().nothrow();
    console.log(
      JSON.stringify(s),
      o.exitCode,
      JSON.stringify(o.stdout.toString()),
      JSON.stringify(o.stderr.toString())
    );
  } catch (e) {
    console.log(JSON.stringify(s), 'throws', e.message);
  }
}
