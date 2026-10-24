import $ from '../../src/$.mjs';
import { example } from './_harness.mjs';
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
    } finally {
      $.unregister('package-hello');
      $.unregister('package-greet');
    }
  }
);
