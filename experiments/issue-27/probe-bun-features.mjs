// Probe which Bun.$ shell features command-stream's $ already supports.
import { $ } from '../../js/src/$.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cs-probe-'));
writeFileSync(join(dir, 'a.txt'), 'A\n');
writeFileSync(join(dir, 'b.txt'), 'B\n');
const cases = {
  text: () => $`echo hi`.quiet().text(),
  'await stdout type': async () => typeof (await $`echo hi`.quiet()).stdout,
  'throws by default': async () => {
    try {
      await $`exit 3`.quiet();
      return 'no throw';
    } catch (e) {
      return 'threw ' + e.exitCode;
    }
  },
  json: () => $`echo '{"a":1}'`.quiet().json?.(),
  lines: async () => {
    const out = [];
    for await (const l of $`printf 'a\nb\n'`.quiet().lines()) {
      out.push(l);
    }
    return out;
  },
  nothrow: async () => (await $`exit 3`.quiet().nothrow()).exitCode,
  'env method': () => $`echo $FOO`.quiet().env({ FOO: 'bar' }).text(),
  'cwd method': () => $`pwd`.quiet().cwd(dir).text(),
  '$.escape': () => $.escape?.('$(foo) `bar` "baz"'),
  '$.braces': () => $.braces?.('echo {1,2,3}'),
  'brace expansion': () => $`echo {a,b}c`.quiet().text(),
  glob: () => $`echo *.txt`.quiet().cwd(dir).text(),
  'cmd substitution': () => $`echo x$(echo y)z`.quiet().text(),
  'var assignment': () => $`FOO=bar; echo $FOO`.quiet().text(),
  'prefix assign': () =>
    $`FOO=baz node -e "console.log(process.env.FOO)"`.quiet().text(),
  export: () => $`export FOO=q; echo $FOO`.quiet().text(),
  'redirect 2>&1': () => $`node -e "console.error('err')" 2>&1`.quiet().text(),
  'redirect to buffer': async () => {
    const b = Buffer.alloc(10);
    await $`echo hi > ${b}`.quiet();
    return b.toString();
  },
  'redirect from response': () =>
    $`cat < ${new Response('resp')}`.quiet().text(),
  'redirect from buffer': () => $`cat < ${Buffer.from('buf')}`.quiet().text(),
  if: () => $`if true; then echo yes; else echo no; fi`.quiet().text(),
  '[[ ]]': () => $`[[ -f a.txt ]] && echo file`.quiet().cwd(dir).text(),
  subshell: () => $`(echo a; echo b)`.quiet().text(),
  'async &': () => $`echo a & echo b`.quiet().text(),
  blob: async () => (await $`echo hi`.quiet().blob?.())?.size,
  arrayBuffer: async () =>
    (await $`echo hi`.quiet().arrayBuffer?.())?.byteLength,
  bytes: async () => (await $`echo hi`.quiet().bytes?.())?.length,
  'Shell class': () => typeof $.Shell,
  '$.nothrow': () => typeof $.nothrow,
  '$.env': () => typeof $.env,
  '$.cwd': () => typeof $.cwd,
  'throws(false)': async () =>
    (await $`exit 2`.quiet().throws?.(false))?.exitCode,
  tilde: () => $`echo ~`.quiet().text(),
  'positional $0': () => $`echo $?`.quiet().text(),
};
for (const [name, fn] of Object.entries(cases)) {
  try {
    const v = await Promise.race([
      fn(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
    ]);
    console.log(name.padEnd(24), '=>', JSON.stringify(v));
  } catch (e) {
    console.log(name.padEnd(24), '!!', e.message.split('\n')[0]);
  }
}
process.exit(0);
