import { createCommandError } from '../$.result.mjs';

export default function createExitCommand(globalShellSettings) {
  return async function exit({ args }) {
    const code = parseInt(args[0] || 0);
    if (globalShellSettings.errexit || code !== 0) {
      throw createCommandError(`Command failed with exit code ${code}`, {
        code,
      });
    }
    return { stdout: '', code };
  };
}
