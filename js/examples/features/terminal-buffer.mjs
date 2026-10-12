import { TerminalBuffer } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'terminal-buffer', title: 'Track virtual terminal frames' },
  async ({ record }) => {
    const terminal = new TerminalBuffer({ rows: 2, cols: 20 });
    try {
      await terminal.write('old\r\x1b[2K\x1b[31mred\x1b[0m');
      await terminal.flush();
      record('visible text', terminal.text().trimEnd());
      record('colored', terminal.text({ color: true }).includes('\x1b['));
    } finally {
      terminal.dispose();
    }
  }
);
