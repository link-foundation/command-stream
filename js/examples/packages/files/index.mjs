import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export default {
  name: '@command-stream-example/files',
  version: '1.0.0',
  commands: {
    'file-count': async ({ args, cwd }) => ({
      code: 0,
      stdout: `${(await readdir(resolve(cwd ?? process.cwd(), args[0] ?? '.'))).length}\n`,
    }),
  },
};
