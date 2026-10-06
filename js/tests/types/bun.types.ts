/**
 * Compile-only tests for `command-stream/bun` and `$.bun`.
 */

import { $ as root } from 'command-stream';
import bunDefault, {
  $,
  Shell,
  ShellError,
  ShellFile,
  ShellOutput,
  ShellPromise,
  type BunShell,
  type ShellExpression,
} from 'command-stream/bun';
import { expectType, use, type Equal } from './helpers.cjs';

export async function bunShell(): Promise<void> {
  expectType<Equal<typeof bunDefault, BunShell>>();
  expectType<Equal<typeof root.bun, BunShell>>();

  const promise = $`echo ${'hello'} ${['a', 'b']} ${{ raw: '| cat' }}`;
  expectType<Equal<typeof promise, ShellPromise>>();
  const output = await promise
    .cwd('/tmp')
    .env({ FOO: 'bar' })
    .preferLocal(true)
    .quiet();
  expectType<Equal<typeof output, ShellOutput>>();
  const stdout: Buffer = output.stdout;
  const code: number = output.exitCode;
  const text: string = await $`echo hi`.text();
  const json: unknown = await $`echo 1`.json();
  for await (const line of $`echo hi`.lines()) {
    expectType<Equal<typeof line, string>>();
  }
  const bytes: Uint8Array = await $`echo hi`.nothrow().bytes();

  try {
    await $`exit 1`.throws(true);
  } catch (error) {
    if (error instanceof ShellError) {
      const failed: number = error.exitCode;
      use(failed, error.stderr.toString(), error.text());
    }
  }

  const sh = new Shell();
  const configured: BunShell = sh
    .cwd('/tmp')
    .env({ A: '1' })
    .preferLocal(['/tmp'])
    .nothrow();
  const nested: BunShell = new $.Shell();
  const escaped: string = $.escape('a b');
  const expanded: string[] = $.braces('{a,b}');
  const file: ShellFile = $.file('out.txt');
  const value: ShellExpression = file;
  const buffer = new Uint8Array(8);
  await $`echo hi > ${buffer}`;

  // @ts-expect-error - $ is a tagged template, not a function of a string
  $('echo hi');
  // @ts-expect-error - env values are strings
  $`echo`.env({ A: 1 });
  // @ts-expect-error - preferLocal accepts paths or a boolean
  $`echo`.preferLocal(42);

  use(stdout, code, text, json, bytes, configured, nested, escaped);
  use(expanded, value);
}
