import { trace, VirtualUtils } from './$.utils.mjs';

export default async function cd({ args }) {
  const target = args[0] || process.env.HOME || process.env.USERPROFILE || '/';
  trace('VirtualCommand', () => `cd: changing directory | ${JSON.stringify({ target }, null, 2)}`);

  try {
    process.chdir(target);
    const newDir = process.cwd();
    trace('VirtualCommand', () => `cd: success | ${JSON.stringify({ newDir }, null, 2)}`);
    return VirtualUtils.success(newDir);
  } catch (error) {
    trace('VirtualCommand', () => `cd: failed | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return { stderr: `cd: ${error.message}`, code: 1 };
  }
}