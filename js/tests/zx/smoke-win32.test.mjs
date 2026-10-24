// Port of zx test/smoke/win32.test.js (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// Like upstream, the suite only runs on Windows (CI: the windows-latest job).

import assert from 'node:assert';
import { test, describe } from 'node:test';
import process from 'node:process';
import '../../src/zx/globals.mjs';
/* global $, which, within, usePowerShell, usePwsh, tmpdir, path, ps */

const _describe = process.platform === 'win32' ? describe : describe.skip;

const _testPwsh = which.sync('pwsh', { nothrow: true }) ? test : test.skip;

_describe('win32', () => {
  test('[zx:test/smoke/win32.test.js:25:3:registration] should work with windows-specific commands', async () => {
    const p = await $`echo $0`; // Bash is first by default.
    assert.match(p.stdout, /bash/);

    await within(async () => {
      usePowerShell();
      assert.match($.shell, /powershell/i);
      const p = await $`get-host`;
      assert.match(p.stdout, /PowerShell/);
    });
  });

  test('[zx:test/smoke/win32.test.js:37:3:registration] quotePowerShell works', async () => {
    await within(async () => {
      usePowerShell();
      const p = await $`echo ${`Windows 'rulez!'`}`;
      assert.match(p.stdout, /Windows 'rulez!'/);
    });
  });

  _testPwsh('should work with pwsh when it is available', async () => {
    await within(async () => {
      usePwsh();
      assert.match($.shell, /pwsh/i);
      const p = await $`echo 'Hello,' && echo ${`new 'PowerShell'!`}`;
      assert.match(p.stdout, /Hello,\s+new 'PowerShell'!/);
    });
  });

  test('[zx:test/smoke/win32.test.js:54:3:registration] should create a dir via mkdir', async () => {
    const temp = tmpdir();
    const _$ = $({ verbose: true, cwd: temp });

    console.log('shell:', $.shell);
    await _$`which bash`;
    await _$`bash --version`;

    await _$`mkdir -p ${path.join(temp, 'AA-zx-test')}`;
    await _$`mkdir -p BB-zx-test`;
    const { stdout } = await _$`ls -l | grep zx-test`;

    assert.match(stdout, /AA-zx-test/);
    assert.match(stdout, /BB-zx-test/);
  });

  test('[zx:test/smoke/win32.test.js:70:3:registration] ps detects self process', async () => {
    const [root] = await ps.lookup({ pid: process.pid });
    assert.equal(root.pid, process.pid);
  });

  test('[zx:test/smoke/win32.test.js:75:3:registration] kill works', async () => {
    const p = $({ nothrow: true })`sleep 100`;
    const { pid } = p;
    const found = await ps.lookup({ pid });
    console.log('found:', found);
    assert.equal(found.length, 1);
    assert.equal(found[0].pid, pid);

    await p.kill();
    const killed = await ps.lookup({ pid });
    console.log('killed:', killed);
    assert.equal(killed.length, 0);
  });

  test('[zx:test/smoke/win32.test.js:89:3:registration] abort controller works', async () => {
    const ac = new AbortController();
    const { signal } = ac;
    const p = $({
      signal,
      timeout: '5s',
      nothrow: true,
      killSignal: 'SIGKILL',
    })`sleep 10`;

    setTimeout(async () => {
      assert.throws(
        () => p.abort('SIGINT'),
        /signal is controlled by another process/
      );
      setTimeout(() => {
        ac.abort('stop');
      }, 500);
    }, 500);

    const o = await p;
    assert.equal(o.signal, 'SIGTERM');
    assert.throws(() => p.abort(), /Too late to abort the process/);
    assert.throws(() => p.kill(), /Too late to kill the process/);
  });
});
