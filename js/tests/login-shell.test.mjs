// Issue #228: simple commands must not run in a login shell. A login shell reads
// /etc/profile and ~/.profile, which reorder the caller's PATH (macOS
// path_helper) and print into stdout. A ~/.profile that prepends /usr/bin and
// prints a line stands in for macOS's /etc/profile on every Unix host.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from '../src/$.mjs';
import { buildCommandArgv } from '../src/$.shell.mjs';
import { isWindows } from './test-helper.mjs';

const home = mkdtempSync(join(tmpdir(), 'command-stream-login-shell-'));
writeFileSync(
  join(home, '.profile'),
  'echo profile-noise\nPATH=/usr/bin:$PATH\nexport PATH\n'
);
afterAll(() => rmSync(home, { recursive: true, force: true }));

const env = {
  ...process.env,
  HOME: home,
  ZDOTDIR: home,
  PATH: `/caller-first:${process.env.PATH}`,
};
const $env = $({ env, mirror: false });

describe.skipIf(isWindows)('default shell is not a login shell (#228)', () => {
  test('a simple command keeps the caller PATH order and clean stdout', async () => {
    const result = await $env`printenv PATH`;
    expect(String(result.stdout)).not.toContain('profile-noise');
    expect(String(result.stdout).split(':')[0]).toBe('/caller-first');
  });

  test('simple commands and pipelines see the same environment', async () => {
    const simple = await $env`printenv PATH`;
    const piped = await $env`printenv PATH | cat`;
    expect(String(simple.stdout)).toBe(String(piped.stdout));
  });

  test('sync mode is not a login shell either', () => {
    const result = $env`printenv PATH`.sync();
    expect(String(result.stdout)).not.toContain('profile-noise');
    expect(String(result.stdout).split(':')[0]).toBe('/caller-first');
  });

  test('the shell argv has no -l flag by default', () => {
    const argv = buildCommandArgv({ mode: 'shell', command: 'true' }, env);
    expect(argv).not.toContain('-l');
    expect(argv.at(-2)).toBe('-c');
  });

  test('loginShell: true opts in to the login environment', async () => {
    const result = await $({
      env,
      mirror: false,
      loginShell: true,
    })`printenv PATH`;
    expect(String(result.stdout)).toContain('profile-noise');
    const argv = buildCommandArgv({ mode: 'shell', command: 'true' }, env, {
      loginShell: true,
    });
    expect(argv.slice(1, 3)).toEqual(['-l', '-c']);
  });
});
