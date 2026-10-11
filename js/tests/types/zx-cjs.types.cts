/**
 * Compile-only tests for `require('command-stream/zx')` (`types/zx.d.cts`).
 */

import zx = require('command-stream/zx');
import helpers = require('./helpers.cjs');

type Equal<A, B> = helpers.Equal<A, B>;
const { expectType, use } = helpers;

export async function commonJs(): Promise<void> {
  const { $, ProcessOutput, fs, YAML, chalk, which } = zx;
  const out = await $`echo hi`.nothrow();
  expectType<Equal<typeof out, zx.ProcessOutput>>();
  const failure: zx.ProcessOutput = new ProcessOutput(1, null, '', '', '');
  const options: Partial<zx.Options> = { verbose: true };
  const bound: zx.Shell = $(options);
  const syncOut: zx.ProcessOutput = $.sync`echo hi`;
  const exists: boolean = await fs.pathExists('a');
  const parsed: unknown = YAML.parse('a: 1');
  const red: string = chalk.red('x');
  const found: string | null = await which('node', { nothrow: true });
  const aliases: boolean = zx.tmpdir === zx.tempdir && zx.globby === zx.glob;

  // Like the ES module, the CommonJS export has no default.
  // @ts-expect-error - no default export
  use(zx.default);
  // @ts-expect-error - not an export
  zx.notAnExport();

  use(failure, bound, syncOut, exists, parsed, red, found, aliases);
}
