import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { $, shell } from '../src/$.mjs';
import { isWindows } from './test-helper.mjs';

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('cd invocation isolation (issue #197)', () => {
  let hostContext;
  let testDir;

  beforeEach(() => {
    shell.errexit(false);
    hostContext = {
      cwd: process.cwd(),
      pwd: process.env.PWD,
      oldpwd: process.env.OLDPWD,
    };
    process.env.PWD = 'host-pwd-sentinel';
    process.env.OLDPWD = 'host-oldpwd-sentinel';
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'cd-isolation-')));
  });

  afterEach(() => {
    shell.errexit(false);
    process.chdir(hostContext.cwd);
    restoreEnv('PWD', hostContext.pwd);
    restoreEnv('OLDPWD', hostContext.oldpwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  test('restores host cwd, PWD, and OLDPWD after standalone cd', async () => {
    const result = await $`cd ${testDir}`;

    expect(result.code).toBe(0);
    expect(process.cwd()).toBe(hostContext.cwd);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test.skipIf(isWindows)(
    'keeps cd active inside one invocation, then restores host context',
    async () => {
      const result = await $`cd ${testDir} && pwd`;

      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(testDir);
      expect(process.cwd()).toBe(hostContext.cwd);
      expect(process.env.PWD).toBe('host-pwd-sentinel');
      expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
    }
  );

  test.skipIf(isWindows)(
    'restores host context when errexit rejects the invocation',
    async () => {
      shell.errexit(true);

      let error;
      try {
        await $`cd ${testDir} && false`;
      } catch (caught) {
        error = caught;
      }

      expect(error?.code).toBe(1);
      expect(process.cwd()).toBe(hostContext.cwd);
      expect(process.env.PWD).toBe('host-pwd-sentinel');
      expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
    }
  );
});
