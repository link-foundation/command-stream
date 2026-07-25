/**
 * `$fy` — shell to mjs translator.
 *
 * This module is only the command-line surface. The translation itself is
 * rule-based and lives in `../fy/`: the script is first formalized as a
 * link-foundation/meta-language links network, then rewritten into JavaScript
 * by a `TranslationRuleSet`.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { translateShellToMjs } from '../fy/index.mjs';

const USAGE = `$fy - Convert shell scripts to command-stream JavaScript modules

Usage:
  $fy <input.sh>              # Translate and print to stdout
  $fy <input.sh> <output.mjs> # Translate and save to a file
  echo "ls -la" | $fy         # Translate from stdin

Options:
  --no-shebang                Omit the leading #!/usr/bin/env node line
  -h, --help                  Show this help

Examples:
  $fy deploy.sh                    # Print the translated deploy script
  $fy build.sh build.mjs           # Translate build.sh into build.mjs
  echo "cd /tmp && ls" | $fy       # Translate a one-liner from stdin

The translation is driven by substitution rules over a meta-language links
network, so pipelines, &&/||, if/while/until/for/case, functions, redirects,
variable assignments and \${...} expansions all translate structurally rather
than textually.
`;

/**
 * Renders translation diagnostics as shell-style warnings.
 *
 * @param {string[]} diagnostics Messages collected by the rule engine.
 * @returns {string} Text for stderr (empty when there is nothing to report).
 */
function formatDiagnostics(diagnostics) {
  const unique = [...new Set(diagnostics)];
  return unique.map((message) => `$fy: warning: ${message}\n`).join('');
}

/**
 * The `$fy` virtual command.
 *
 * @param {{args?: string[], stdin?: string|Buffer}} invocation Command input.
 * @returns {{stdout?: string, stderr?: string, code: number}} Command result.
 */
export function $fy({ args = [], stdin } = {}) {
  const options = { shebang: !args.includes('--no-shebang') };
  const positional = args.filter((argument) => !argument.startsWith('-'));
  // A file argument always wins: `$fy in.sh` must read `in.sh` even when the
  // command happens to inherit a non-empty stdin from its caller.
  const hasStdin =
    positional.length === 0 && stdin !== undefined && String(stdin).length > 0;

  if (args.includes('-h') || args.includes('--help')) {
    return { stdout: USAGE, code: 0 };
  }
  if (!hasStdin && positional.length === 0) {
    return { stderr: USAGE, code: 1 };
  }

  let source;
  if (hasStdin) {
    source = String(stdin);
  } else {
    try {
      source = readFileSync(positional[0], 'utf8');
    } catch (error) {
      return {
        stderr: `$fy: cannot read '${positional[0]}': ${error.message}\n`,
        code: 1,
      };
    }
  }

  let translated;
  try {
    translated = translateShellToMjs(source, options);
  } catch (error) {
    return { stderr: `$fy: translation failed: ${error.message}\n`, code: 1 };
  }

  const stderr = formatDiagnostics(translated.diagnostics);
  const outputFile = hasStdin ? undefined : positional[1];
  if (!outputFile) {
    return { stdout: translated.code, stderr, code: 0 };
  }

  try {
    writeFileSync(outputFile, translated.code);
  } catch (error) {
    return {
      stderr: `${stderr}$fy: cannot write '${outputFile}': ${error.message}\n`,
      code: 1,
    };
  }
  return { stdout: `Translated to '${outputFile}'\n`, stderr, code: 0 };
}

export default $fy;
