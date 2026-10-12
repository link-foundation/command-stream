import $, { compose } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
await example(
  { id: 'command-packages', title: 'Compose and extend virtual commands' },
  async ({ record }) => {
    $.create('package-hello', ({ args }) => ({
      code: 0,
      stdout: args.join(' '),
    }));
    try {
      $.inherit('package-greet', 'package-hello', { args: ['hello'] });
      $.extend('package-greet', async (context, next) => {
        const result = await next(context);
        return { ...result, stdout: `${result.stdout}!` };
      });
      record(
        'inherited middleware',
        await (await $({ mirror: false })`package-greet world`).text()
      );
      let rejected = 0;
      for (const name of [
        '',
        'two words',
        '7command',
        'command;echo',
        'écho',
        'line\n',
      ]) {
        try {
          $.create(name, () => ({ code: 0 }));
        } catch {
          rejected++;
        }
      }
      record('invalid names rejected', rejected);
      $.create(
        'package-pipeline',
        compose(
          async function* () {
            yield 'one\n';
            yield 'two\n';
          },
          ({ stdin }) => ({
            code: 7,
            stdout: stdin.toUpperCase(),
            stderr: 'stop',
          }),
          () => {
            throw new Error('continued after failure');
          }
        )
      );
      const result = await $({
        mirror: false,
        errexit: false,
      })`package-pipeline`;
      record('streamed composition', [
        result.code,
        await result.text(),
        result.stderr.toString(),
      ]);

      const file = join(makeTempDir('command-package'), 'commands.mjs');
      const definition = (version, commands) =>
        `export default {name:'parity-package',version:'${version}',commands:{${commands}}};`;
      await writeFile(
        file,
        definition('1', "'package-installed':()=>({code:0,stdout:'one'})")
      );
      const installed = await $.install(file, { install: false });
      try {
        const idempotent =
          (await $.install(file, { install: false })) === installed;
        await writeFile(file, definition('bad', "'bad name':()=>({code:0})"));
        try {
          await installed.reload();
        } catch {
          /* working package remains */
        }
        const retained =
          installed.version === '1' &&
          (await (await $({ mirror: false })`package-installed`).text()) ===
            'one';
        await writeFile(
          file,
          definition('2', "'package-reloaded':()=>({code:0,stdout:'two'})")
        );
        await installed.reload();
        record('atomic package reload', [
          idempotent,
          retained,
          installed.version,
          !$.listCommands().includes('package-installed'),
        ]);
      } finally {
        installed.uninstall();
      }
      record(
        'registry discovery',
        await $.marketplace.search('git & deploy', {
          fetch: async (url) => {
            const request = new URL(url);
            if (
              request.searchParams.get('text') !==
              'keywords:command-stream-command git & deploy'
            ) {
              throw new Error('query changed');
            }
            return {
              ok: true,
              json: async () => ({
                objects: [
                  {
                    package: {
                      name: 'tools',
                      version: '1',
                      description: 'Git helpers',
                    },
                  },
                ],
              }),
            };
          },
        })
      );
    } finally {
      $.unregister('package-hello');
      $.unregister('package-greet');
      $.unregister('package-pipeline');
    }
  }
);
