import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
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
  let otherTestDir;

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
    otherTestDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'cd-isolation-other-'))
    );
  });

  afterEach(() => {
    shell.errexit(false);
    process.chdir(hostContext.cwd);
    restoreEnv('PWD', hostContext.pwd);
    restoreEnv('OLDPWD', hostContext.oldpwd);
    rmSync(testDir, { recursive: true, force: true });
    rmSync(otherTestDir, { recursive: true, force: true });
  });

  test('restores host cwd, PWD, and OLDPWD after standalone cd', async () => {
    const result = await $`cd ${testDir}`;

    expect(result.code).toBe(0);
    expect(process.cwd()).toBe(hostContext.cwd);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test('keeps cd active inside one invocation, then restores host context', async () => {
    const result = await $`cd ${testDir} && pwd`;

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(testDir);
    expect(process.cwd()).toBe(hostContext.cwd);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test('restores host context when errexit rejects the invocation', async () => {
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
  });

  test('isolates overlapping invocations while cd is active', async () => {
    const [first, second, observer] = await Promise.all([
      $`cd ${testDir} && sleep 0.1 && pwd`,
      $`cd ${otherTestDir} && sleep 0.2 && pwd`,
      $`sleep 0.05 && pwd`,
    ]);

    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe(testDir);
    expect(second.code).toBe(0);
    expect(second.stdout.trim()).toBe(otherTestDir);
    expect(observer.code).toBe(0);
    expect(observer.stdout.trim()).toBe(hostContext.cwd);
    expect(process.cwd()).toBe(hostContext.cwd);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test.skipIf(isWindows)(
    'updates an explicit cwd for later virtual and real commands',
    async () => {
      const nestedDir = join(testDir, 'nested');
      mkdirSync(nestedDir);
      writeFileSync(join(nestedDir, 'marker.txt'), 'nested marker');

      const pwdResult = await $({ cwd: testDir })`cd nested && pwd`;
      const catResult = await $({ cwd: testDir })`cd nested && cat marker.txt`;
      const realResult = await $({ cwd: testDir })`cd nested && /bin/pwd`;

      expect(pwdResult.code).toBe(0);
      expect(pwdResult.stdout.trim()).toBe(nestedDir);
      expect(catResult.code).toBe(0);
      expect(catResult.stdout).toBe('nested marker');
      expect(realResult.code).toBe(0);
      expect(realResult.stdout.trim()).toBe(nestedDir);
      expect(process.cwd()).toBe(hostContext.cwd);
    }
  );

  test.skipIf(isWindows)(
    'uses a valid fallback when the saved cwd and home directories are gone',
    async () => {
      const deletedCwd = mkdtempSync(join(tmpdir(), 'cd-deleted-cwd-'));
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const missingHome = join(deletedCwd, 'missing-home');

      try {
        process.chdir(deletedCwd);
        rmSync(deletedCwd, { recursive: true, force: true });
        process.env.HOME = missingHome;
        process.env.USERPROFILE = missingHome;

        const result = await $`cd ${testDir}`;

        expect(result.code).toBe(0);
        expect(process.cwd()).toBe(realpathSync(tmpdir()));
        expect(process.env.PWD).toBe('host-pwd-sentinel');
        expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
      } finally {
        process.chdir(hostContext.cwd);
        restoreEnv('HOME', originalHome);
        restoreEnv('USERPROFILE', originalUserProfile);
      }
    }
  );
});
