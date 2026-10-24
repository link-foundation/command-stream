import $, { extend } from '../src/$.mjs';
extend('ls', async (context, next) => {
  const result = await next(context);
  return {
    ...result,
    stdout: String(result.stdout).replace(
      /[^\n]+/g,
      (line) => `\x1b[32m${line}\x1b[0m`
    ),
  };
});
await $`ls`;
