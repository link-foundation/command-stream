import $ from '../src/$.mjs';
import { fileURLToPath } from 'node:url';

// The deployment package emits a plan; it does not contact a production service.
const installed = await $.install(
  fileURLToPath(new URL('./packages/deploy/index.mjs', import.meta.url)),
  { install: false }
);
try {
  $.create('ecosystem-validate-env', ({ args }) =>
    ['development', 'staging', 'production'].includes(args[0])
      ? { code: 0, stdout: `Validated ${args[0]}\n` }
      : { code: 1, stderr: `Invalid environment: ${args[0]}\n` }
  );

  // Middleware supports pre-validation and post-processing with one next hook,
  // including handlers that return async generators.
  $.extend('deploy-plan', async function* (context, next) {
    const validation = await $({
      mirror: false,
      errexit: true,
    })`ecosystem-validate-env ${context.args[0]}`;
    yield await validation.text();
    for await (const chunk of next(context)) {
      yield chunk;
    }
    yield 'Audit: deployment plan prepared\n';
  });
  $.inherit('ecosystem-production-plan', 'deploy-plan', {
    args: ['production'],
  });

  await $({
    mirror: false,
    capture: false,
  })`ecosystem-production-plan release-1`
    .stream()
    .forEach((line) => console.log(line));
  console.log('Demo complete');
} finally {
  $.unregister('ecosystem-production-plan');
  $.unregister('ecosystem-validate-env');
  installed.uninstall();
}
