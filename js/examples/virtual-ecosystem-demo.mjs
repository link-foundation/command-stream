import $, { compose } from '../src/$.mjs';
import { fileURLToPath } from 'node:url';

// Local packages make this example runnable before independent npm publication.
const installed = [];
const names = ['ecosystem-welcome', 'ecosystem-greet', 'ecosystem-fruit-list'];
try {
  for (const name of ['git-tools', 'files', 'text']) {
    const pkg = await $.install(
      fileURLToPath(new URL(`./packages/${name}/index.mjs`, import.meta.url)),
      { install: false }
    );
    installed.push(pkg);
    console.log(
      `Installed ${pkg.name}@${pkg.version}: ${[...pkg.handlers.keys()].join(', ')}`
    );
  }

  $.create('ecosystem-welcome', ({ args }) => ({
    code: 0,
    stdout: `Welcome, ${args.join(' ')}!\n`,
  }));
  $.inherit('ecosystem-greet', 'ecosystem-welcome', { args: ['developer'] });
  $.extend('ecosystem-greet', async (context, next) => {
    const result = await next(context);
    return { ...result, stdout: `[enhanced] ${result.stdout}` };
  });
  console.log(await (await $({ mirror: false })`ecosystem-greet Alice`).text());

  $.create(
    'ecosystem-fruit-list',
    compose(
      async function* () {
        yield 'apple\n';
        yield 'banana\n';
      },
      ({ stdin }) => ({ code: 0, stdout: stdin.toUpperCase() })
    )
  );
  console.log(await (await $({ mirror: false })`ecosystem-fruit-list`).text());
  console.log(
    `Files in this directory: ${await (await $({ mirror: false })`file-count`).text()}`
  );

  // Search the real npm registry only when explicitly requested.
  if (process.argv.includes('--search')) {
    const packages = await $.marketplace.search('git');
    console.log(packages.map((pkg) => `${pkg.name}@${pkg.version}`).join('\n'));
  }
  console.log('Demo complete');
} finally {
  names.forEach((name) => $.unregister(name));
  installed.reverse().forEach((pkg) => pkg.uninstall());
}
