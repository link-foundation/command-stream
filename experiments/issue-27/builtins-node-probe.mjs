import {
  SMALL_BUILTINS,
  Builtin,
  formatF32,
  parseF32,
} from '../../js/src/bun-shell/builtin.mjs';
import { ShellExecEnv, envMapFromObject } from '../../js/src/bun-shell/env.mjs';
async function run(kind, args) {
  const shell = new ShellExecEnv({
    cwd: process.cwd(),
    exportEnv: envMapFromObject(process.env),
  });
  const b = new Builtin({
    kind,
    args,
    shell,
    stdin: { kind: 'ignore' },
    stdout: { kind: 'buf', target: 'stdout' },
    stderr: { kind: 'buf', target: 'stderr' },
  });
  const code = await SMALL_BUILTINS[kind](b);
  return [
    code,
    shell.bufferedStdout.toString(),
    shell.bufferedStderr.toString(),
  ];
}
const cases = [
  ['seq', ['1', '0.1', '1.5']],
  ['seq', ['1', '1e-7', '1.0000003']],
  ['seq', ['1e20', '1e20']],
  ['seq', ['-3']],
  ['seq', ['.5', '3']],
  ['seq', ['inf']],
  ['echo', ['-e', '\\x41g\\0101\\cb']],
  ['echo', ['a\n\n\n']],
  ['echo', ['\n\n\n']],
  ['exit', ['+3']],
  ['exit', ['99999999999999999999']],
  ['basename', ['a/b/', '/', 'a\\b', '']],
  ['dirname', ['a/b/', '/', 'a//b', 'a/', '', '//']],
  ['which', ['sh', 'nope']],
  ['seq', ['-s,', '-t!', '3']],
];
for (const [k, a] of cases) {
  console.log(k, JSON.stringify(a), JSON.stringify(await run(k, a)));
}
