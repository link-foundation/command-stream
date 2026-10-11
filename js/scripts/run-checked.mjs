// command-stream keeps errexit disabled by default. Release mutations must
// explicitly reject nonzero exits before emitting success or writing metadata.
export async function runChecked(command, options = {}) {
  const result = await command.run({ capture: true, ...options });
  if (result.code !== 0) {
    throw new Error(
      `Release command failed (exit ${result.code}): ${result.stderr || result.stdout || 'no output'}`
    );
  }
  return result;
}
