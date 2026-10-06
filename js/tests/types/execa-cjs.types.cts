import api = require('command-stream/execa');
import $ = require('command-stream');
import { use } from './helpers.cjs';
export async function contracts(): Promise<void> {
  const text: string = (await api.execa('node', ['--version'])).stdout;
  const lines: string[] = api.execaSync('node', ['--version'], {
    lines: true,
  }).stdout;
  await $.execaCompat().execa('node', ['--version']);
  await $.execaNode('example.mjs', [], { ipc: false });
  use(text, lines, api.ExecaError, api.getOneMessage);
  // @ts-expect-error - invalid argv
  api.execa('node', 42);
}
