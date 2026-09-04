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
import { $, register, shell, unregister } from '../src/$.mjs';
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
    unregister('issue-197-hold');
    unregister('issue-197-nested-cd');
    shell.errexit(false);
    process.chdir(hostContext.cwd);
    restoreEnv('PWD', hostContext.pwd);
    restoreEnv('OLDPWD', hostContext.oldpwd);
    rmSync(testDir, { recursive: true, force: true });
    rmSync(otherTestDir, { recursive: true, force: true });
  });

  test('preserves host cwd, PWD, and OLDPWD during standalone cd', async () => {
    const result = await $`cd ${testDir}`;

    expect(result.code).toBe(0);
    expect(process.cwd()).toBe(hostContext.cwd);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test('keeps cd active inside one invocation without changing host context', async () => {
    const result = await $`cd ${testDir} && pwd`;

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(testDir);
    expect(process.cwd()).toBe(hostContext.cwd);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test('preserves host context when errexit rejects the invocation', async () => {
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
    'never exposes invocation cwd or env to synchronous observers',
    async () => {
      let signalStarted;
      let releaseHold;
      const started = new Promise((resolve) => {
        signalStarted = resolve;
      });
      const hold = new Promise((resolve) => {
        releaseHold = resolve;
      });
      register('issue-197-hold', async () => {
        signalStarted();
        await hold;
        return { code: 0, stdout: '', stderr: '' };
      });

      const runner = $({ mirror: false })`cd ${testDir} && issue-197-hold`;
      const pending = runner.then((result) => result);
      await started;

      try {
        const observer = $({ mirror: false })`pwd`.sync();
        expect(observer.stdout.trim()).toBe(hostContext.cwd);
        expect(process.cwd()).toBe(hostContext.cwd);
        expect(process.env.PWD).toBe('host-pwd-sentinel');
        expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
      } finally {
        releaseHold();
        await pending;
      }
    }
  );

  test('allows a custom virtual command to await a nested cd invocation', async () => {
    register('issue-197-nested-cd', async () => {
      const result = await $({ mirror: false })`cd ${testDir} && pwd`;
      return {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    });
    const controller = new AbortController();
    const runner = $({
      mirror: false,
      signal: controller.signal,
    })`issue-197-nested-cd`;
    const outcome = await Promise.race([
      runner.then((result) => ({ result })),
      new Promise((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), 250)
      ),
    ]);

    if (outcome.timedOut) {
      controller.abort();
      await runner;
    }

    expect(outcome.timedOut).toBeUndefined();
    expect(outcome.result.stdout.trim()).toBe(testDir);
    expect(process.cwd()).toBe(hostContext.cwd);
  });

  test('does not execute a command whose signal was already aborted', async () => {
    const marker = join(testDir, 'should-not-exist');
    const controller = new AbortController();
    controller.abort();

    const runner = $({
      mirror: false,
      signal: controller.signal,
    })`touch ${marker}`;
    const result = await runner;

    expect(result.code).toBe(143);
    expect(result).toBe(runner.result);
    expect(result.stderr).toBe('Process killed with SIGTERM');
    expect(() => realpathSync(marker)).toThrow();
  });

  test('rotates invocation PWD and OLDPWD without mutating configured env', async () => {
    const configuredEnv = {
      ...process.env,
      HOME: testDir,
      PWD: 'configured-pwd-sentinel',
      OLDPWD: otherTestDir,
    };

    const homeResult = await $({
      env: configuredEnv,
      mirror: false,
    })`cd && pwd`;
    const dashResult = await $({
      cwd: testDir,
      env: configuredEnv,
      mirror: false,
    })`cd - && pwd`;
    expect(homeResult.stdout.trim()).toBe(testDir);
    expect(dashResult.stdout.trim().split('\n')).toEqual([
      otherTestDir,
      otherTestDir,
    ]);
    expect(configuredEnv.PWD).toBe('configured-pwd-sentinel');
    expect(configuredEnv.OLDPWD).toBe(otherTestDir);
    expect(process.env.PWD).toBe('host-pwd-sentinel');
    expect(process.env.OLDPWD).toBe('host-oldpwd-sentinel');
  });

  test('discards cwd changes made inside a subshell', async () => {
    const result = await $({
      mirror: false,
    })`cd ${testDir} && (cd ${otherTestDir} && pwd) && pwd`;

    expect(result.code).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([otherTestDir, testDir]);
    expect(process.cwd()).toBe(hostContext.cwd);
  });

  test('updates an explicit cwd for later virtual commands', async () => {
    const nestedDir = join(testDir, 'nested');
    mkdirSync(nestedDir);
    writeFileSync(join(nestedDir, 'marker.txt'), 'nested marker');

    const pwdResult = await $({ cwd: testDir })`cd nested && pwd`;
    const catResult = await $({ cwd: testDir })`cd nested && cat marker.txt`;

    expect(pwdResult.code).toBe(0);
    expect(pwdResult.stdout.trim()).toBe(nestedDir);
    expect(catResult.code).toBe(0);
    expect(catResult.stdout).toBe('nested marker');
    expect(process.cwd()).toBe(hostContext.cwd);
  });

  test.skipIf(isWindows)(
    'passes invocation cwd and env to later real commands',
    async () => {
      const childEnv = await $({
        cwd: testDir,
        mirror: false,
      })`cd ${otherTestDir} && /usr/bin/env`;
      const realPwd = await $({
        cwd: testDir,
        mirror: false,
      })`cd ${otherTestDir} && /bin/pwd`;

      expect(childEnv.stdout).toContain(`PWD=${otherTestDir}\n`);
      expect(childEnv.stdout).toContain(`OLDPWD=${testDir}\n`);
      expect(realPwd.stdout.trim()).toBe(otherTestDir);
      expect(process.cwd()).toBe(hostContext.cwd);
    }
  );

  test.skipIf(isWindows)(
    'does not repair or otherwise mutate an invalid host cwd',
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

        const result = await $`cd ${testDir} && pwd`;

        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe(testDir);
        expect(process.cwd()).toBe(deletedCwd);
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
