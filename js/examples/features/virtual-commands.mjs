// Any JavaScript function can be registered as a command and then used from a
// command line like a real binary.
import { $, register, unregister, listCommands } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'virtual-commands', title: 'Registering your own commands' },
  async ({ record }) => {
    register('greet', async ({ args }) => ({
      stdout: `Hello, ${args.join(' ') || 'world'}!\n`,
      code: 0,
    }));

    record('the command is registered', listCommands().includes('greet'));
    record('without arguments', (await $q`greet`).stdout);
    record('with arguments', (await $q`greet Node and Bun`).stdout);

    // A handler decides its own exit code and may write to stderr.
    register('fail-with', async ({ args }) => ({
      stderr: `failing on purpose\n`,
      code: Number(args[0] ?? 1),
    }));
    const failed = await $q`fail-with 42`;
    record('custom exit code', failed.code);
    record('custom stderr', failed.stderr);

    unregister('greet');
    unregister('fail-with');
    record('unregistered again', listCommands().includes('greet'));
  }
);
