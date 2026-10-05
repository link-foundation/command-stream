/**
 * Compile-only tests for `require('command-stream/zx/cli')`
 * (`types/zx-cli.d.cts`).
 */

import cli = require('command-stream/zx/cli');
import helpers = require('./helpers.cjs');

type Equal<A, B> = helpers.Equal<A, B>;
const { expectType, use } = helpers;

export async function commonJsCli(): Promise<void> {
  expectType<Equal<typeof cli.main, () => Promise<void>>>();
  const entry: boolean = cli.isMain(`file://${__filename}`);
  const ext: string | undefined = cli.normalizeExt('.ts');
  const script: string = cli.transformMarkdown('```js\n1\n```');
  cli.injectGlobalRequire(__filename);

  expectType<Equal<typeof cli.argv._, Array<string | number>>>();

  // @ts-expect-error - zx's runScript is not exported
  use(cli.runScript);

  use(entry, ext, script);
}
