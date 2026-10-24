/** Virtual surface; keep parser dependencies out of normal library imports. */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseFyArguments, FY_USAGE } from '../fy/cli-options.mjs';

export async function $fy({ args = [], stdin, cwd } = {}) {
  try {
    const { options, positional } = parseFyArguments(args);
    if (options.help) {
      return { stdout: FY_USAGE, code: 0 };
    }
    const [input, output] = positional;
    const fromStdin = !input || input === '-';
    if (!fromStdin) {
      options.name = basename(input);
    }
    if (fromStdin && (stdin === undefined || String(stdin).length === 0)) {
      return { stderr: FY_USAGE, code: 1 };
    }
    let source;
    try {
      source = fromStdin
        ? String(stdin)
        : readFileSync(resolve(cwd ?? process.cwd(), input), 'utf8');
    } catch (error) {
      return {
        stderr: `$fy: cannot read '${input}': ${error.message}\n`,
        code: 1,
      };
    }
    const { translateSource, translateShellToMjs } =
      await import('../fy/index.mjs');
    const translated = options.structural
      ? translateShellToMjs(source, options)
      : translateSource(source, options);
    const stderr = [...new Set(translated.diagnostics)]
      .map((message) => `$fy: warning: ${message}\n`)
      .join('');
    if (!output) {
      return { stdout: translated.code, stderr, code: 0 };
    }
    try {
      writeFileSync(resolve(cwd ?? process.cwd(), output), translated.code, {
        flag: 'wx',
        mode: 0o755,
      });
    } catch (error) {
      return {
        stderr: `${stderr}$fy: cannot write '${output}': ${error.message}\n`,
        code: 1,
      };
    }
    return { stdout: `Translated to '${output}'\n`, stderr, code: 0 };
  } catch (error) {
    return { stderr: `$fy: translation failed: ${error.message}\n`, code: 1 };
  }
}
export default $fy;
