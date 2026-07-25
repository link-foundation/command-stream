// `$fy`: rule-based translation of shell scripts into command-stream modules.
//
// The pipeline has two halves, exactly as link-foundation/meta-language models
// translation:
//
//   1. Formalize  shell source -> links network   (`shell-formalizer.mjs`)
//   2. Substitute links network -> JavaScript     (`translation-rules.mjs`)
//
// Step 2 contains no shell knowledge beyond the rule table, and step 1 contains
// no JavaScript knowledge at all.

import { formalizeShell } from './shell-formalizer.mjs';
import { RuleEngine } from './rule-engine.mjs';
import {
  LANGUAGE_FALLBACKS,
  MODES,
  TARGET,
  buildRuleSet,
} from './translation-rules.mjs';

/** Terms whose presence requires `const args = process.argv.slice(2)`. */
const ARGUMENT_TERMS = ['positional', 'all-arguments', 'argument-count'];

/** Builds the module header the translated statements need. */
function buildPreamble(terms, names, options) {
  const imports = ['$'];
  if (terms.has('set-option')) {
    imports.push('shell');
  }

  const lines = [];
  if (options.shebang !== false) {
    lines.push('#!/usr/bin/env node');
  }
  lines.push(
    `import { ${imports.join(', ')} } from '${options.moduleName ?? 'command-stream'}';`
  );
  lines.push('');

  if (ARGUMENT_TERMS.some((term) => terms.has(term))) {
    lines.push('const args = process.argv.slice(2);');
  }
  if (terms.has('exit-status')) {
    lines.push('let exitCode = 0;');
  }
  // Shell variables have no block scope, so every non-`local` binding is
  // hoisted to the top of the module rather than declared at its first
  // assignment (which would break on reassignment inside a loop or branch).
  const hoisted = [...names.bound].filter((name) => !names.locals.has(name));
  if (hoisted.length > 0) {
    lines.push(`let ${hoisted.join(', ')};`);
  }
  if (lines[lines.length - 1] !== '') {
    lines.push('');
  }
  // The trailing empty entry plus this newline separate the preamble from the
  // first translated statement by exactly one blank line.
  return `${lines.join('\n')}\n`;
}

/**
 * Translates a shell script into a command-stream ES module.
 *
 * @param {string} source Shell source text.
 * @param {object} [options]
 * @param {boolean} [options.shebang] Emit a `#!/usr/bin/env node` line (default true).
 * @param {string} [options.moduleName] Module to import `$` from.
 * @returns {{code: string, preamble: string, body: string, diagnostics: string[], network: object}}
 *   `code` is `preamble + body`; the halves are returned separately so callers
 *   (and tests) can inspect the translated statements on their own.
 */
export function translateShellToMjs(source, options = {}) {
  // A shell script checked out with CRLF endings is still a shell script: `\r`
  // is not a token, so it is dropped before anything else looks at the text.
  const normalized = source.replace(/\r\n?/g, '\n');
  // A `#!/bin/sh` line selects the interpreter for the *shell* script; the
  // translated module gets its own shebang from `buildPreamble`.
  const script = normalized.replace(/^#![^\n]*\n?/, '');
  const { network, root, terms, names } = formalizeShell(script);
  const ruleSet = buildRuleSet({ trackExitCode: terms.has('exit-status') });
  const engine = new RuleEngine(network, ruleSet, {
    language: TARGET,
    fallbacks: LANGUAGE_FALLBACKS,
    modes: MODES,
  });

  const body = `${engine.render(root)}`
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*$/, '\n');
  const preamble = buildPreamble(terms, names, options);

  return {
    code: `${preamble}${body}`,
    preamble,
    body,
    diagnostics: engine.report(),
    network,
    ruleSet,
  };
}

export { formalizeShell } from './shell-formalizer.mjs';
export { parseShellScript } from './shell-script-parser.mjs';
export { buildRuleSet } from './translation-rules.mjs';
export { RuleEngine } from './rule-engine.mjs';
