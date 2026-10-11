import { test, expect } from 'bun:test';
import * as api from '../src/$.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandMetadata } from '../src/command-packages.mjs';

test('create, extend and inheritance preserve wrapped generator output', async () => {
  expect(typeof api.$.create).toBe('function');
  api.$.create('package-generator', async function* () {
    yield 'hello\n';
  });
  api.$.extend('package-generator', (context, next) => next(context));
  api.$.inherit('package-child', 'package-generator');
  try {
    expect(
      await (await api.sh('package-child', { mirror: false })).text()
    ).toBe('hello\n');
    expect(
      await (await api.sh('package-child | cat', { mirror: false })).text()
    ).toBe('hello\n');
  } finally {
    api.unregister('package-generator');
    api.unregister('package-child');
  }
});

test('package installs atomically, reloads changed handlers and uninstalls', async () => {
  expect(typeof api.$.install).toBe('function');
  const dir = await mkdtemp(join(tmpdir(), 'command-packages-'));
  const file = join(dir, 'commands.mjs');
  try {
    await writeFile(
      file,
      "export default { name: 'fixture', version: '1.0.0', commands: { 'package-greet': async () => ({stdout:'one'}) } };"
    );
    const installed = await api.$.install(file);
    expect(
      await (await api.sh('package-greet', { mirror: false })).text()
    ).toBe('one');
    await writeFile(
      file,
      "export default { name: 'fixture', version: '1.0.1', commands: { 'package-greet': async () => ({stdout:'two'}) } };"
    );
    await installed.reload();
    expect(
      await (await api.sh('package-greet', { mirror: false })).text()
    ).toBe('two');
    await writeFile(
      file,
      'export default { commands: { good: async () => ({}), bad: 7 } };'
    );
    await expect(installed.reload()).rejects.toThrow();
    expect(api.listCommands()).not.toContain('good');
    installed.uninstall();
    expect(api.listCommands()).not.toContain('package-greet');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('marketplace discovery uses encoded npm queries and mock transport', async () => {
  expect(typeof api.$.marketplace?.search).toBe('function');
  let requested;
  const result = await api.$.marketplace.search('git & deploy', {
    fetch: async (url) => {
      requested = new URL(url);
      return {
        ok: true,
        json: async () => ({
          objects: [{ package: { name: 'fixture', version: '1.0.0' } }],
        }),
      };
    },
  });
  expect(requested.searchParams.get('text')).toContain('git & deploy');
  expect(result[0].name).toBe('fixture');
});

test('package replacement restores metadata and reload respects external overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-ownership-'));
  const file = join(dir, 'commands.mjs');
  let installed;
  api.$.create('ownership-fixture', () => ({ stdout: 'original' }), {
    description: 'Original command',
  });
  try {
    await writeFile(
      file,
      "export default {commands: {'ownership-fixture': () => ({stdout: 'package'})}}"
    );
    installed = await api.$.install(file, { replace: true });
    installed.uninstall();
    expect(commandMetadata.get('ownership-fixture').description).toBe(
      'Original command'
    );
    api.unregister('ownership-fixture');
    installed = await api.$.install(file);
    api.$.create('ownership-fixture', () => ({ stdout: 'override' }));
    await expect(installed.reload()).rejects.toThrow('already registered');
    installed.uninstall();
    expect(
      await (await api.sh('ownership-fixture', { mirror: false })).text()
    ).toBe('override');
  } finally {
    installed?.uninstall();
    api.unregister('ownership-fixture');
    expect(commandMetadata.has('ownership-fixture')).toBe(false);
    await rm(dir, { recursive: true, force: true });
  }
});
