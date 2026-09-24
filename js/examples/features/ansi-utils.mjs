// Helpers for dealing with ANSI escape sequences and control characters in
// captured output.
import {
  AnsiUtils,
  processOutput,
  configureAnsi,
  getAnsiConfig,
} from '../../src/$.mjs';
import { example } from './_harness.mjs';

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);

await example(
  { id: 'ansi-utils', title: 'ANSI and control character helpers' },
  async ({ record }) => {
    const coloured = `${ESC}[31mred${ESC}[0m and ${ESC}[32mgreen${ESC}[0m`;
    record('stripAnsi removes the colours', AnsiUtils.stripAnsi(coloured));
    record(
      'stripControlChars keeps text readable',
      AnsiUtils.stripControlChars(`beep${BELL}boop`)
    );
    record(
      'stripAll does both',
      AnsiUtils.stripAll(`${ESC}[31mred${ESC}[0m${BELL}`)
    );
    record(
      'cleanForProcessing handles buffers',
      AnsiUtils.cleanForProcessing(Buffer.from(coloured)).toString()
    );

    // The same helpers can be applied to every captured chunk through the global
    // configuration.
    const original = getAnsiConfig();
    record('default config', original);
    configureAnsi({ preserveAnsi: false });
    record('processOutput with preserveAnsi disabled', processOutput(coloured));
    configureAnsi(original);
    record('config restored', getAnsiConfig());
  }
);
