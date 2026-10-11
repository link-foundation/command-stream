import $, { compose, extend, testing } from '../src/$.mjs';
import { fileURLToPath } from 'node:url';

const packages = [];
try {
  for (const name of ['git-tools', 'deploy', 'text', 'logs']) {
    packages.push(
      await $.install(
        fileURLToPath(new URL(`./packages/${name}/index.mjs`, import.meta.url))
      )
    );
  }
  extend('upper', async (context, next) => ({
    ...(await next(context)),
    stderr: 'Processed by audit middleware\n',
  }));
  $.create(
    'release-label',
    compose(
      (context) => ({ code: 0, stdout: context.args.join(' ') }),
      (context) => ({ code: 0, stdout: context.stdin.toUpperCase() })
    )
  );
  // External release actions are isolated with scoped mocks for this example.
  await testing.withMocks(
    { 'git-summary': { stdout: 'clean\n', code: 0 } },
    async () => {
      console.log(await (await $({ mirror: false })`git-summary`).text());
      await $({ mirror: false, capture: false })`deploy-plan staging release-1`
        .stream()
        .forEach((line) => console.log(line));
    }
  );
  console.log(
    await $({ mirror: false })`log-records OK ERROR OK`.stream().analyze({
      errorRate: (line) => JSON.parse(line).level === 'error',
      throughput: true,
    })
  );
} finally {
  $.unregister('release-label');
  packages.forEach((installed) => installed.uninstall());
}
