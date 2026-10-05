// Port of zx test/log.test.ts (issue #26). Test vectors come from
// google/zx (Apache-2.0); colors are forced on as in the upstream suite.

import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { after, before, beforeEach, describe, test } from 'node:test';
import { formatCmd, log } from '../../src/zx/log.mjs';
import { chalk } from '../../src/zx/vendor-core.mjs';

describe('zx log', () => {
  describe('log()', () => {
    const data = [];
    const stream = {
      write(s) {
        data.push(s);
      },
    };

    let level;
    before(() => {
      log.output = stream;
      level = chalk.level;
      chalk.level = 1;
    });

    after(() => {
      chalk.level = level;
      delete log.output;
      delete log.formatters;
    });

    beforeEach(() => (data.length = 0));

    test('[zx:test/log.test.ts:37:5:registration] empty log', () => {
      log({
        kind: 'cmd',
        cmd: 'echo hi',
        cwd: process.cwd(),
        id: '1',
        verbose: false,
      });
      assert.equal(data.join(''), '');
    });

    test('[zx:test/log.test.ts:48:5:registration] cmd', () => {
      log({
        kind: 'cmd',
        cmd: 'echo hi',
        cwd: process.cwd(),
        id: '1',
        verbose: true,
      });
      assert.equal(data.join(''), '$ \x1B[92mecho\x1B[39m hi\n');
    });

    test('[zx:test/log.test.ts:59:5:registration] stdout', () => {
      log({
        kind: 'stdout',
        data: Buffer.from('foo'),
        id: '1',
        verbose: true,
      });
      assert.equal(data.join(''), 'foo');
    });

    test('[zx:test/log.test.ts:69:5:registration] cd', () => {
      log({
        kind: 'cd',
        dir: '/tmp',
        verbose: true,
      });
      assert.equal(data.join(''), '$ \x1B[92mcd\x1B[39m /tmp\n');
    });

    test('[zx:test/log.test.ts:78:5:registration] fetch', () => {
      log({
        kind: 'fetch',
        url: 'https://github.com',
        init: { method: 'GET' },
        verbose: true,
      });
      assert.equal(
        data.join(''),
        "$ \x1B[92mfetch\x1B[39m https://github.com { method: 'GET' }\n"
      );
    });

    test('[zx:test/log.test.ts:91:5:registration] custom', () => {
      log({
        kind: 'custom',
        data: 'test',
        verbose: true,
      });
      assert.equal(data.join(''), 'test');
    });

    test('[zx:test/log.test.ts:100:5:registration] retry', () => {
      log({
        kind: 'retry',
        attempt: 1,
        total: 3,
        delay: 1000,
        exception: new Error('foo'),
        error: 'bar',
        verbose: true,
      });
      assert.equal(
        data.join(''),
        '\x1B[41m\x1B[37m FAIL \x1B[39m\x1B[49m Attempt: 1/3; next in 1000ms\n'
      );
    });

    test('[zx:test/log.test.ts:116:5:registration] end', () => {
      log({
        kind: 'end',
        id: '1',
        exitCode: null,
        signal: null,
        duration: 0,
        error: null,
        verbose: true,
      });
      assert.equal(data.join(''), '');
    });

    test('[zx:test/log.test.ts:129:5:registration] kill', () => {
      log({
        kind: 'kill',
        signal: null,
        pid: 1234,
      });
      assert.equal(data.join(''), '');
    });

    test('[zx:test/log.test.ts:138:5:registration] formatters', () => {
      log.formatters = {
        cmd: ({ cmd }) => `CMD: ${cmd}`,
      };

      log({
        kind: 'cmd',
        cmd: 'echo hi',
        cwd: process.cwd(),
        id: '1',
        verbose: true,
      });
      assert.equal(data.join(''), 'CMD: echo hi');
    });
  });

  test('[zx:test/log.test.ts:154:3:registration] formatCwd()', () => {
    const level = chalk.level;
    chalk.level = 1;
    const cases = [
      [
        `echo $'hi'`,
        "$ \x1B[92mecho\x1B[39m \x1B[93m$\x1B[39m\x1B[93m'hi'\x1B[39m\n",
      ],
      [`echo$foo`, '$ \x1B[92mecho\x1B[39m\x1B[93m$\x1B[39mfoo\n'],
      [
        `test --foo=bar p1 p2`,
        '$ \x1B[92mtest\x1B[39m --foo\x1B[31m=\x1B[39mbar p1 p2\n',
      ],
      [
        `cmd1 --foo || cmd2`,
        '$ \x1B[92mcmd1\x1B[39m --foo \x1B[31m|\x1B[39m\x1B[31m|\x1B[39m\x1B[92m cmd2\x1B[39m\n',
      ],
      [
        `A=B C='D' cmd`,
        "$ A\x1B[31m=\x1B[39mB C\x1B[31m=\x1B[39m\x1B[93m'D'\x1B[39m\x1B[92m cmd\x1B[39m\n",
      ],
      [
        `foo-extra --baz = b-a-z --bar = 'b-a-r' -q -u x`,
        "$ \x1B[92mfoo-extra\x1B[39m --baz \x1B[31m=\x1B[39m b-a-z --bar \x1B[31m=\x1B[39m \x1B[93m'b-a-r'\x1B[39m -q -u x\n",
      ],
      [
        `while true; do "$" done`,
        '$ \x1B[96mwhile\x1B[39m true\x1B[31m;\x1B[39m\x1B[96m do\x1B[39m \x1B[93m"$"\x1B[39m\x1B[96m done\x1B[39m\n',
      ],
      [
        `echo '\n str\n'`,
        "$ \x1B[92mecho\x1B[39m \x1B[93m'\x1B[39m\x1B[0m\x1B[0m\n\x1B[0m> \x1B[0m\x1B[93m str\x1B[39m\x1B[0m\x1B[0m\n\x1B[0m> \x1B[0m\x1B[93m'\x1B[39m\n",
      ],
      [`$'\\''`, "$ \x1B[93m$\x1B[39m\x1B[93m'\\'\x1B[39m\x1B[93m'\x1B[39m\n"],
      [
        'sass-compiler --style=compressed src/static/bootstrap.scss > dist/static/bootstrap-v5.3.3.min.css',
        '$ \x1B[92msass-compiler\x1B[39m --style\x1B[31m=\x1B[39mcompressed src/static/bootstrap.scss \x1B[31m>\x1B[39m\x1B[92m dist/static/bootstrap-v5.3.3.min.css\x1B[39m\n',
      ],
      [
        'echo 1+2 | bc',
        '$ \x1B[92mecho\x1B[39m 1\x1B[31m+\x1B[39m2 \x1B[31m|\x1B[39m\x1B[92m bc\x1B[39m\n',
      ],
      [
        'echo test &>> filepath',
        '$ \x1B[92mecho\x1B[39m test \x1B[31m&\x1B[39m\x1B[31m>\x1B[39m\x1B[31m>\x1B[39m\x1B[92m filepath\x1B[39m\n',
      ],
      [
        'bc < filepath',
        '$ \x1B[92mbc\x1B[39m \x1B[31m<\x1B[39m\x1B[92m filepath\x1B[39m\n',
      ],
      [
        `cat << 'EOF' | tee -a filepath
line 1
line 2
EOF`,
        "$ \x1B[92mcat\x1B[39m \x1B[31m<\x1B[39m\x1B[31m<\x1B[39m \x1B[93m'EOF'\x1B[39m \x1B[31m|\x1B[39m\x1B[92m tee\x1B[39m -a filepath\x1B[0m\x1B[0m\n\x1B[0m> \x1B[0mline 1\x1B[0m\x1B[0m\n\x1B[0m> \x1B[0mline 2\x1B[96m\x1B[39m\x1B[0m\x1B[0m\n\x1B[0m> \x1B[0m\x1B[96mEOF\x1B[39m\n",
      ],
    ];

    cases.forEach(([input, expected]) => {
      assert.equal(formatCmd(input), expected, input);
    });
    chalk.level = level;
  });
});
