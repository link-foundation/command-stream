// A command handler receives a context object describing how it was invoked.
import { $, register, unregister } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';

await example({ id: 'virtual-context', title: 'The handler context' }, async ({ record }) => {
  const dir = makeTempDir('context');

  register('describe', async ({ args, stdin, cwd, env, options }) => ({
    stdout: JSON.stringify({
      args,
      stdin,
      cwdIsTheOneWeAskedFor: cwd === dir,
      envValue: env.DEMO,
      mirror: options.mirror
    }) + '\n',
    code: 0
  }));

  const result = await $({ mirror: false, cwd: dir, env: { DEMO: 'from-options' } })`echo piped | describe one two`;
  record('context seen by the handler', JSON.parse(result.stdout));

  unregister('describe');
});
