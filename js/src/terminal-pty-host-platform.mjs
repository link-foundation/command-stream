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
