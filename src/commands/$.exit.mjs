export default function createExitCommand(globalShellSettings) {
  return async function exit({ args }) {
    const code = parseInt(args[0] || 0);
    if (globalShellSettings.errexit || code !== 0) {
      const error = new Error(`Command failed with exit code ${code}`);
      error.code = code;
      error.exitCode = code;
      throw error;
    }
    return { stdout: '', code };
  };
}