import {
  execa,
  execaSync,
  execaCommand,
  execaCommandSync,
  execaCompat,
  create,
  isExecaChildProcess,
  ExecaError,
  type Options,
} from 'command-stream/execa';
import { $ } from 'command-stream';
import { use } from './helpers.cjs';

export async function contracts(): Promise<void> {
  const child = execa('node', ['--version']);
  child.kill('SIGTERM');
  const text: string = (await child).stdout;
  const commandLines: string[] = (
    await execaCommand({ lines: true })('node --version')
  ).stdout;
  const commandBytes: Uint8Array = execaCommandSync('node --version', {
    encoding: 'buffer',
  }).stdout;
  const lines: string[] = (await execa({ lines: true })`node --version`).stdout;
  const bytes: Uint8Array = execaSync('node', ['--version'], {
    encoding: 'buffer',
  }).stdout;
  const factoryLines: string[] = (
    await $.execaCompat({ lines: true }).execaCommand('node --version')
  ).stdout;
  const factoryText: string = (
    await create({ lines: true })
      .create({ lines: false })
      .execa('node', ['--version'])
  ).stdout;
  const factoryScript: Uint8Array = create({ encoding: 'buffer' }).$
    .sync`node --version`.stdout;
  const options: Options = {
    reject: false,
    cwd: new URL('file:///tmp/'),
    cancelSignal: new AbortController().signal,
  };
  const bound = create(options);
  const boundLines: string[] = (
    await create({ lines: true }).execa('node', ['--version'])
  ).stdout;
  const boundBytes: Uint8Array = create({ encoding: 'buffer' }).execaSync(
    'node',
    ['--version']
  ).stdout;
  const result = await bound.execa`node --version`;
  await $.execa('node', ['--version']);
  await $.execaCompat(options).execaNode('example.mjs', [], { ipc: false });
  await execaCompat().execaCommand('node --version');
  if (isExecaChildProcess(child)) {
    child.iterable();
  }
  const error: Error = new ExecaError();
  use(
    text,
    commandLines,
    commandBytes,
    lines,
    bytes,
    result,
    error,
    boundLines,
    boundBytes,
    factoryLines,
    factoryText,
    factoryScript
  );
  // @ts-expect-error - argv must be an array
  execa('node', '--version');
  // @ts-expect-error - incorrect encoding
  execa({ encoding: 'invalid' });
  // @ts-expect-error - option types are inherited from Execa
  create({ reject: 'false' });
}
