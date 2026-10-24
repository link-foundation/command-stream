// Interactive `command-stream --repl` session with zx globals (issue #26).

import process from 'node:process';
import repl from 'node:repl';
import { inspect } from 'node:util';
import { chalk, defaults, os, path, ProcessOutput } from './core.mjs';

const HISTORY =
  process.env.ZX_REPL_HISTORY ?? path.join(os.homedir(), '.zx_repl_history');

/**
 * Start a REPL where ProcessOutput values print as their trimmed text.
 *
 * @param {string} history History file path.
 * @returns {Promise<void>}
 */
export function startRepl(history = HISTORY) {
  defaults.verbose = false;
  const r = repl.start({
    prompt: chalk.greenBright.bold('❯ '),
    useGlobal: true,
    preview: false,
    writer(output) {
      return output instanceof ProcessOutput
        ? output.toString().trimEnd()
        : inspect(output, { colors: true });
    },
  });
  r.setupHistory(history, () => {});
  return Promise.resolve();
}
