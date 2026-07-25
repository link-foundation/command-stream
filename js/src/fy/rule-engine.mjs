// Recursive rule engine for translating a meta-language links network.
//
// meta-language models translation as a `TranslationRuleSet`: a query per
// source construct plus a template per target language. Its own
// `TranslationRuleSet.render` applies the *first* rule that matches and does
// not recurse into a template's placeholders, so it cannot translate a nested
// tree (see `experiments/meta-language-gaps.mjs` for reproductions, and
// `docs/meta-language-gaps.md` for the report filed upstream).
//
// This engine keeps meta-language's rule model — the rules really are
// `TranslationRule`s carrying `LinkQuery`s and per-language templates — and
// supplies only the missing evaluation strategy:
//
//   * bottom-up recursion through placeholders,
//   * variadic placeholders over a node's children,
//   * conditional segments for optional captures,
//   * automatic indentation of multi-line substitutions.
//
// Once meta-language grows these, this file collapses into a call to
// `network.reconstructTextAsWithRules(...)`.

import { LinkType } from 'meta-language';

/** Placeholder: `{name}`, `{name:mode}`, `{*name:mode|separator}`. */
const PLACEHOLDER =
  /^\{(\*?)([A-Za-z_][A-Za-z0-9_-]*|\.)(?::([a-z]+))?(?:\|([^}]*))?\}/;
/** Conditional segment: `{?name}` ... `{/name}`. */
const CONDITIONAL_OPEN = /^\{\?([A-Za-z_][A-Za-z0-9_-]*)\}/;

const SEPARATOR_ESCAPES = { n: '\n', t: '\t', s: ' ' };

function decodeSeparator(separator) {
  if (separator === undefined) {
    return '';
  }
  return separator.replace(
    /\\(.)/g,
    (match, character) => SEPARATOR_ESCAPES[character] ?? character
  );
}

/** Indents every line after the first by `indent`. */
function indentContinuation(value, indent) {
  if (indent === '' || !value.includes('\n')) {
    return value;
  }
  return value
    .split('\n')
    .map((line, position) =>
      position === 0 || line === '' ? line : indent + line
    )
    .join('\n');
}

/** The whitespace run at the end of `output`, if `output` ends on a blank line prefix. */
function currentIndent(output) {
  const lastNewline = output.lastIndexOf('\n');
  const line = output.slice(lastNewline + 1);
  return /^[ \t]*$/.test(line) ? line : '';
}

export class RuleEngine {
  /**
   * @param {object} network A meta-language `LinkNetwork`.
   * @param {object} ruleSet A meta-language `TranslationRuleSet`.
   * @param {object} [options]
   * @param {string} [options.language] Default target language.
   * @param {Record<string, string[]>} [options.fallbacks] Per-language template
   *   fallback chains, e.g. `{'JavaScript:value': ['JavaScript:command']}`.
   * @param {Record<string, {language?: string, transform?: (text: string) => string}>} [options.modes]
   *   Placeholder modes. A mode either renders the captured link in another
   *   target language, post-processes the captured source text, or both.
   */
  constructor(network, ruleSet, options = {}) {
    this.network = network;
    this.ruleSet = ruleSet;
    this.language = options.language ?? 'JavaScript';
    this.fallbacks = options.fallbacks ?? {};
    this.modes = options.modes ?? {};
    this.rulesByLink = new Map();
    this.diagnostics = [];

    // Rule selection is query-driven: each rule's `LinkQuery` is evaluated
    // against the whole network once, and the first rule to claim a link owns it.
    for (const rule of ruleSet.rules) {
      for (const match of network.find(rule.query)) {
        const key = String(match.linkId?.asU64?.() ?? match.linkId);
        if (!this.rulesByLink.has(key)) {
          this.rulesByLink.set(key, rule);
        }
      }
    }
  }

  /** Diagnostics collected while rendering (constructs with no rule). */
  report() {
    return [...this.diagnostics];
  }

  /**
   * Renders one link.
   *
   * @param {object} linkId Link to render.
   * @param {string} [language] Target language, defaulting to the engine's.
   * @returns {string} Translated text.
   */
  render(linkId, language = this.language) {
    const key = String(linkId?.asU64?.() ?? linkId);
    const rule = this.rulesByLink.get(key);
    const link = this.network.link(linkId);
    if (!rule) {
      // Source tokens are leaves and are expected to render as their own text;
      // an unclaimed *syntax* node means a construct nobody translates.
      if (link?.metadata().linkType === LinkType.Syntax) {
        this.diagnostics.push(
          `no translation rule for \`${link.metadata().term}\``
        );
      }
      return this.network.capturedText(linkId);
    }

    const template = this.templateFor(rule, language);
    if (!template) {
      this.diagnostics.push(
        `rule \`${rule.name}\` has no ${language} template`
      );
      return this.network.capturedText(linkId);
    }
    return this.expand(template.text, rule, link, language);
  }

  /** Looks a template up through the configured fallback chain. */
  templateFor(rule, language) {
    for (const candidate of [language, ...(this.fallbacks[language] ?? [])]) {
      const template = rule.templateFor(candidate);
      if (template) {
        return template;
      }
    }
    return undefined;
  }

  /** Resolves a capture name to a child link id. */
  resolve(rule, link, name) {
    if (name === '.') {
      return link.id();
    }
    const index = rule.referenceCaptures?.[name];
    if (index === undefined) {
      return undefined;
    }
    return link.references()[index];
  }

  /** Renders `linkId` in the mode a placeholder asked for. */
  renderMode(linkId, mode, language) {
    if (mode === undefined) {
      return this.render(linkId, language);
    }
    const definition = this.modes[mode];
    if (!definition) {
      this.diagnostics.push(`unknown placeholder mode \`${mode}\``);
      return this.render(linkId, language);
    }
    const rendered = definition.language
      ? this.render(linkId, definition.language)
      : this.network.capturedText(linkId);
    return definition.transform ? definition.transform(rendered) : rendered;
  }

  expand(source, rule, link, language) {
    let output = '';
    let index = 0;

    while (index < source.length) {
      const rest = source.slice(index);

      if (rest.startsWith('{{')) {
        output += '{';
        index += 2;
        continue;
      }
      if (rest.startsWith('}}')) {
        output += '}';
        index += 2;
        continue;
      }

      const conditional = CONDITIONAL_OPEN.exec(rest);
      if (conditional) {
        const name = conditional[1];
        const close = source.indexOf(`{/${name}}`, index);
        const end = close === -1 ? source.length : close;
        const body = source.slice(index + conditional[0].length, end);
        if (this.resolve(rule, link, name) !== undefined) {
          output += this.expand(body, rule, link, language);
        }
        index = close === -1 ? source.length : close + name.length + 3;
        continue;
      }

      const placeholder = PLACEHOLDER.exec(rest);
      if (placeholder) {
        const [matched, variadic, name, mode, separator] = placeholder;
        const target = this.resolve(rule, link, name);
        if (target === undefined) {
          // An unresolved capture renders as nothing rather than as its own
          // source text, so optional children simply disappear.
          index += matched.length;
          continue;
        }

        const indent = currentIndent(output);
        let value;
        if (variadic) {
          const children = this.network.link(target)?.references() ?? [];
          value = children
            .map((child) =>
              indentContinuation(this.renderMode(child, mode, language), indent)
            )
            .join(decodeSeparator(separator));
        } else {
          value = indentContinuation(
            this.renderMode(target, mode, language),
            indent
          );
        }
        output += value;
        index += matched.length;
        continue;
      }

      output += source[index];
      index += 1;
    }

    return output;
  }
}
