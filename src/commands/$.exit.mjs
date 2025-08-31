export default function createExitCommand(globalShellSettings) {
  return async function exit({ args }) {
    const code = parseInt(args[0] || 0);
    if (globalShellSettings.errexit || code !== 0) {
      throw { code, message: `Command failed with exit code ${code}` };
    }
    return { stdout: '', code };
  };
}