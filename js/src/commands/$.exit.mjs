import { createCommandError } from '../$.result.mjs';

export default function createExitCommand() {
  return async function exit({ args }) {
    const code = parseInt(args[0] || 0);
    if (code !== 0) {
      // An exit status is silent; keep the rejection message out of stderr.
      throw createCommandError(`Command failed with exit code ${code}`, {
        code,
        stderr: '',
      });
    }
    return { stdout: '', code };
  };
}
