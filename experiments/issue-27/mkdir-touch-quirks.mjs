// Quick exploration of Bun's mkdir/touch quirks (run under bun).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-quirks-'));
fs.writeFileSync(path.join(dir, 'file'), 'x');
const cases = [
  ['mkdir', []],
  ['mkdir', ['-p']],
  ['mkdir', ['-x']],
  ['mkdir', ['-px', 'a']],
  ['mkdir', ['-pxy', 'a']],
  ['mkdir', ['--verbose', 'a']],
  ['mkdir', ['--vebose', 'v1']],
  ['mkdir', ['--']],
  ['mkdir', ['--', 'a']],
  ['mkdir', ['-']],
  ['mkdir', ['-m', '755', 'a']],
  ['mkdir', ['-pm', 'a']],
  ['mkdir', ['--mode', 'a']],
  ['mkdir', ['--mode=7', 'a']],
  ['mkdir', ['-v', 'b1', 'b1', '-p']],
  ['mkdir', ['-pv', `${dir}/c1//d/e/`]],
  ['mkdir', ['-pv', 'c2/./x/../y/']],
  ['mkdir', ['-v', '']],
  ['mkdir', ['-pv', '']],
  ['touch', []],
  ['touch', ['-c', 'f']],
  ['touch', ['-x', 'f']],
  ['touch', ['--time', 'f']],
  ['touch', ['--date=1', 'f']],
  ['touch', ['--foo']],
  ['touch', ['-']],
  ['touch', ['--']],
  ['touch', ['--', 'f']],
  ['touch', ['nodir/f']],
  ['touch', [`${dir}/./t1/../t2`]],
  ['touch', ['/etc/passwd']],
  ['touch', ['file/x']],
  ['touch', ['file/']],
  ['touch', [`${dir}/file/`]],
];
for (const [k, a] of cases) {
  const r = await Bun.$`${k} ${a}`.cwd(dir).nothrow().quiet();
  console.log(
    k,
    JSON.stringify(a),
    JSON.stringify([
      r.exitCode,
      r.stdout.toString().replaceAll(dir, '$D'),
      r.stderr.toString().replaceAll(dir, '$D'),
    ])
  );
}
console.log(fs.readdirSync(dir, { recursive: true }).sort().join(' '));
