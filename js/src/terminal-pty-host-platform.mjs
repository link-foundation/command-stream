import { chmodSync, statSync } from 'node:fs';

// node-pty 1.1.0 packages macOS spawn-helper binaries with mode 0644.
// Repair only a helper missing owner execute permission; keep existing modes.
export const prepareSpawnHelper = (helperPath, platform = process.platform) => {
  if (platform !== 'darwin') {
    return;
  }
  const { mode } = statSync(helperPath);
  if ((mode & 0o100) === 0) {
    chmodSync(helperPath, mode | 0o111);
  }
};

export const stopTerminal = (
  terminal,
  signal = 'SIGTERM',
  platform = process.platform
) => {
  if (!terminal) {
    return;
  }
  if (platform === 'win32') {
    terminal.kill();
    return;
  }
  terminal.kill(signal);
};
