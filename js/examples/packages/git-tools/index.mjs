import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = async (args, { cwd, env }) => {
  try {
    const result = await promisify(execFile)('git', args, { cwd, env });
    return { ...result, code: 0 };
  } catch (error) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
      code: Number.isInteger(error.code) ? error.code : 127,
    };
  }
};
export default {
  name: '@command-stream-example/git-tools',
  version: '1.0.0',
  commands: {
    'git-summary': (context) => execute(['status', '--short'], context),
    'git-recent': (context) =>
      execute(['log', '--oneline', '-n', context.args[0] ?? '5'], context),
  },
};
