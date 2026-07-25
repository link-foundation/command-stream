// The Shell -> JavaScript substitution rules.
//
// Every construct the formalizer can produce has exactly one
// `TranslationRule` here: a `LinkQuery` selecting the links it owns, plus one
// template per target language. Nothing about the translation lives outside
// this file — `rule-engine.mjs` only walks the network and substitutes.
//
// Four target languages express the four contexts a node can appear in:
//
//   JavaScript             a statement          `await $`ls`;`
//   JavaScript:command     text inside $`...`   `ls`
//   JavaScript:value       text inside `...`    `ls` without shell quoting
//   JavaScript:expression  a JavaScript value   `process.env.HOME`
//
// Placeholder syntax is documented in `rule-engine.mjs`.

import {
  LinkQuery,
  LinkType,
  TranslationRule,
  TranslationRuleSet,
} from 'meta-language';

import { SHELL_LANGUAGE } from './shell-formalizer.mjs';

export const TARGET = 'JavaScript';
export const COMMAND = `${TARGET}:command`;
export const VALUE = `${TARGET}:value`;
export const EXPRESSION = `${TARGET}:expression`;

/** A `:value` rendering falls back to the `:command` one when unquoting is a no-op. */
export const LANGUAGE_FALLBACKS = { [VALUE]: [COMMAND] };

/** `set -e` and friends map onto `shell.set('e')`. */
const SET_FLAGS = { e: 'errexit', v: 'verbose', x: 'xtrace' };

/** Escapes text so it survives inside a JavaScript template literal. */
function escapeTemplate(text) {
  return text.replace(/([`\\])/g, '\\$1').replace(/\$\{/g, '\\${');
}

/**
 * Removes the shell quoting from a literal. Quotes are meaningful to the shell
 * (word splitting, globbing) so they are kept in `:command` context, but a
 * JavaScript value must not contain them.
 */
function stripShellQuotes(text) {
  let output = '';
  let quote;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\' && quote !== "'") {
      output += text[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (character === quote) {
      quote = undefined;
      continue;
    }
    output += character;
  }
  return output;
}

/** Placeholder modes available to the templates below. */
export const MODES = {
  /** Raw shell source text of the captured link. */
  text: {},
  /** The captured link rendered as shell command text. */
  command: { language: COMMAND },
  /** The captured link rendered as an unquoted value. */
  value: { language: VALUE },
  /** The captured link rendered as a JavaScript expression. */
  expr: { language: EXPRESSION },
  /** The captured link as a JavaScript string (a template literal). */
  string: { language: VALUE, transform: (text) => `\`${text}\`` },
  /** Literal source text, escaped for a template literal. */
  literal: { transform: escapeTemplate },
  /** Literal source text with shell quoting removed. */
  unquoted: { transform: (text) => escapeTemplate(stripShellQuotes(text)) },
  /** A `set` operand such as `-e`, as a `shell.set` argument. */
  flag: {
    transform: (text) => {
      const letter = text.replace(/^-+/, '');
      return JSON.stringify(SET_FLAGS[letter] ? letter : text);
    },
  },
};

const syntax = (term) =>
  new LinkQuery({
    linkType: LinkType.Syntax,
    language: SHELL_LANGUAGE,
  }).withTerm(term);

/**
 * Declares one rule.
 *
 * @param {string} term Node term the rule owns.
 * @param {Record<string, number>} captures Capture name -> reference index.
 * @param {Record<string, string>} templates Target language -> template text.
 */
function rule(term, captures, templates) {
  const created = new TranslationRule(term, syntax(term));
  // meta-language 0.46.0 has no reference-capture API (see
  // `docs/meta-language-gaps.md`); the engine reads this property directly.
  created.referenceCaptures = captures;
  for (const [language, text] of Object.entries(templates)) {
    created.withTemplate(language, text);
  }
  return created;
}

/** A word expansion: one JavaScript expression, interpolated in command text. */
function expansion(term, expression) {
  return rule(
    term,
    { name: 0 },
    {
      // `{{`/`}}` are literal braces, so this emits `${<expression>}`.
      [COMMAND]: `\${{${expression}}}`,
      [VALUE]: `\${{${expression}}}`,
      [EXPRESSION]: expression,
    }
  );
}

/**
 * Builds the Shell -> JavaScript rule set.
 *
 * @param {object} [options]
 * @param {boolean} [options.trackExitCode] Emit `exitCode = ...` for each
 *   command, which is only needed when the script reads `$?`.
 * @returns {TranslationRuleSet}
 */
export function buildRuleSet(options = {}) {
  const runCommand = options.trackExitCode
    ? 'exitCode = (await $`{.:command}`).code;'
    : 'await $`{.:command}`;';

  return new TranslationRuleSet('shell-to-javascript', [
    ...structureRules(runCommand),
    ...controlFlowRules(),
    ...declarationRules(),
    ...expansionRules(),
  ]);
}

/** Script structure, commands, pipelines and the `&&`/`||` operators. */
function structureRules(runCommand) {
  return [
    // ---- Script structure ----------------------------------------------
    rule('script', {}, { [TARGET]: '{*.|\\n}', [COMMAND]: '{*.:command|; }' }),
    rule('block', {}, { [TARGET]: '{*.|\\n}', [COMMAND]: '{*.:command|; }' }),
    rule('blank', {}, { [TARGET]: '' }),
    rule('comment', { body: 0 }, { [TARGET]: '// {body:text}' }),

    // ---- Commands -------------------------------------------------------
    rule(
      'command',
      { words: 0, redirects: 1, prefix: 2 },
      {
        [TARGET]: runCommand,
        [COMMAND]:
          '{?prefix}{prefix:command} {/prefix}{words:command}{redirects:command}',
      }
    ),
    rule('word-list', {}, { [COMMAND]: '{*.:command| }' }),
    rule('redirect-list', {}, { [COMMAND]: '{*.:command}' }),
    rule(
      'redirect',
      { operator: 0, target: 1 },
      { [COMMAND]: ' {operator:text}{target:command}' }
    ),
    rule('assignment-list', {}, { [COMMAND]: '{*.:command| }' }),
    rule('word', {}, { [COMMAND]: '{*.:command}', [VALUE]: '{*.:value}' }),

    rule(
      'pipeline',
      {},
      { [TARGET]: runCommand, [COMMAND]: '{*.:command| | }' }
    ),
    rule(
      'subshell',
      { body: 0 },
      { [TARGET]: runCommand, [COMMAND]: '({body:command})' }
    ),

    // ---- Operators ------------------------------------------------------
    // `a && b` is a conditional, not a boolean expression: `b` runs only when
    // `a` exits zero. In command position the shell operator is kept as is.
    rule(
      'and',
      { left: 0, right: 1 },
      {
        [TARGET]: 'if ((await $`{left:command}`).code === 0) {\n  {right}\n}',
        [COMMAND]: '{left:command} && {right:command}',
      }
    ),
    rule(
      'or',
      { left: 0, right: 1 },
      {
        [TARGET]: 'if ((await $`{left:command}`).code !== 0) {\n  {right}\n}',
        [COMMAND]: '{left:command} || {right:command}',
      }
    ),
  ];
}

/** `if`, loops, `case` and function definitions. */
function controlFlowRules() {
  return [
    // ---- Control flow ---------------------------------------------------
    rule(
      'if',
      { condition: 0, consequent: 1, alternative: 2 },
      {
        [TARGET]:
          'if ((await $`{condition:command}`).code === 0) {\n  {consequent}\n}' +
          '{?alternative} else {\n  {alternative}\n}{/alternative}',
      }
    ),
    rule(
      'while',
      { condition: 0, body: 1 },
      {
        [TARGET]:
          'while ((await $`{condition:command}`).code === 0) {\n  {body}\n}',
      }
    ),
    rule(
      'until',
      { condition: 0, body: 1 },
      {
        [TARGET]:
          'while ((await $`{condition:command}`).code !== 0) {\n  {body}\n}',
      }
    ),
    rule(
      'for',
      { name: 0, items: 1, body: 2 },
      {
        [TARGET]:
          'for (const {name:text} of [{*items:string|, }]) {\n  {body}\n}',
      }
    ),
    rule(
      'case',
      { subject: 0, branches: 1 },
      { [TARGET]: 'switch ({subject:string}) {\n  {*branches|\n  }\n}' }
    ),
    rule(
      'case-branch',
      { patterns: 0, body: 1 },
      { [TARGET]: '{patterns}\n  {body}\n  break;' }
    ),
    rule('pattern-list', {}, { [TARGET]: '{*.|\\n}' }),
    rule('pattern', { name: 0 }, { [TARGET]: 'case {name:string}:' }),
    // `*` is the shell's catch-all pattern.
    rule('pattern-default', {}, { [TARGET]: 'default:' }),
    rule(
      'function',
      { name: 0, body: 1 },
      { [TARGET]: 'async function {name:text}(...args) {\n  {body}\n}' }
    ),
    rule(
      'name',
      { name: 0 },
      { [TARGET]: '{name:text}', [COMMAND]: '{name:text}' }
    ),
  ];
}

/** Assignments, `export`/`local`, and the shell builtins with a JS equivalent. */
function declarationRules() {
  return [
    // ---- Declarations and builtins --------------------------------------
    rule(
      'assignment',
      { name: 0, value: 1 },
      { [TARGET]: '{name:text} = {value:string};' }
    ),
    rule(
      'local',
      { name: 0, value: 1 },
      { [TARGET]: 'let {name:text} = {value:string};' }
    ),
    rule(
      'export',
      { name: 0, value: 1 },
      { [TARGET]: 'process.env.{name:text} = {value:string};' }
    ),
    rule('set-option', {}, { [TARGET]: 'shell.set({*.:flag|, });' }),
    rule('exit', {}, { [TARGET]: 'process.exit({*.:value|});' }),
    rule(
      'return',
      { first: 0 },
      { [TARGET]: 'return{?first} {first:string}{/first};' }
    ),
    rule('source', { file: 0 }, { [TARGET]: 'await import({file:string});' }),
  ];
}

/** The leaves produced by the word expander. */
function expansionRules() {
  return [
    // ---- Word expansions -------------------------------------------------
    rule(
      'literal',
      { name: 0 },
      {
        [COMMAND]: '{name:literal}',
        [VALUE]: '{name:unquoted}',
        [EXPRESSION]: '{name:string}',
      }
    ),
    expansion('variable', '{name:text}'),
    expansion('env-variable', 'process.env.{name:text}'),
    expansion('positional', 'args[{name:text}]'),
    expansion('script-name', 'process.argv[1]'),
    expansion('all-arguments', "args.join(' ')"),
    expansion('argument-count', 'args.length'),
    expansion('exit-status', 'exitCode'),
    expansion('process-id', 'process.pid'),
    rule(
      'default-expansion',
      { name: 0, value: 1, fallback: 2 },
      {
        [COMMAND]: '${{{value:expr} ?? {fallback:string}}}',
        [VALUE]: '${{{value:expr} ?? {fallback:string}}}',
        [EXPRESSION]: '({value:expr} ?? {fallback:string})',
      }
    ),
    rule(
      'substitution',
      { body: 0 },
      {
        [COMMAND]: '${{(await $`{body:command}`).stdout.trim()}}',
        [VALUE]: '${{(await $`{body:command}`).stdout.trim()}}',
        [EXPRESSION]: '(await $`{body:command}`).stdout.trim()',
      }
    ),
    // Anything the expander could not classify stays a shell expansion: the
    // escaped `\${...}` reaches command-stream's shell verbatim rather than
    // being silently mistranslated.
    rule(
      'unsupported-expansion',
      { name: 0 },
      { [COMMAND]: '\\${{{name:text}}}', [VALUE]: '\\${{{name:text}}}' }
    ),
  ];
}
