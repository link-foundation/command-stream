/**
 * Compile-only tests for `command-stream/zx/globals`
 * (`types/zx-globals.d.ts`).
 */

import 'command-stream/zx/globals';
import type * as zx from 'command-stream/zx';
import { expectType, use, type Equal } from './helpers.cjs';

export async function globals(): Promise<void> {
  // Every export of `command-stream/zx` (except `fetch`) is a global.
  expectType<Equal<typeof $, typeof zx.$>>();
  expectType<Equal<typeof globalThis.$, typeof zx.$>>();
  expectType<Equal<typeof fs, typeof zx.fs>>();
  expectType<Equal<typeof YAML, typeof zx.YAML>>();
  expectType<Equal<typeof MAML, typeof zx.MAML>>();
  expectType<Equal<typeof tmpdir, typeof zx.tempdir>>();

  // The classes are available as values and as types.
  const out: ProcessOutput = await $`echo hi`;
  const p: ProcessPromise = $`true`;
  const isOutput: boolean = out instanceof ProcessOutput;
  const isFail: boolean = new Error() instanceof Fail;

  cd('/tmp');
  await sleep('10ms');
  echo(chalk.green(await fs.readFile('a.txt', 'utf8')));
  const found: string = await which('node');
  const files: string[] = await glob('*');
  const parsed = minimist(process.argv.slice(2));
  const all: string =
    VERSION + version + versions.zx + path.sep + os.EOL + quote('x');
  const tmp: string = tempdir() + tempfile() + tmpfile();

  // `fetch` keeps the standard global type (no `.pipe`).
  // @ts-expect-error - the zx fetch overload is not declared globally
  use(fetch('https://example.com').pipe);

  use(p, isOutput, isFail, found, files, parsed, all, tmp);
  use(argv, bus, defaults, dotenv, expBackoff, globby, kill, log, nothrow);
  use(parseArgv, ps, question, quiet, quotePowerShell, resolveDefaults);
  use(retry, spinner, stdin, syncProcessCwd, updateArgv, useBash);
  use(usePowerShell, usePwsh, within);
}
