'use strict';

// Reuse the maintained, dependency-free glob engine. Unlike globby, fast-glob
// does not expand a literal directory operand into its descendants.
const { globbySync } = require('./runtime.cjs');
const { checkPattern } = require('./glob-safety.cjs');

function prepare(pattern, options, ignored = false) {
  if (typeof pattern !== 'string') {
    return [pattern];
  }
  // Upstream brace preprocessing strips unescaped quote delimiters.
  const normalized =
    options?.braceExpansion !== false && /[{}]/.test(pattern)
      ? pattern.replace(/\\.|(["'`])/g, (match, quote) => (quote ? '' : match))
      : pattern;
  if (normalized !== pattern && /[})]/.test(normalized)) {
    checkPattern(normalized);
  }
  if (options?.globstar === false) {
    const negative = normalized.startsWith('!') && !normalized.startsWith('!(');
    const value = negative ? normalized.slice(1) : normalized;
    const single = value.replace(/(^|\/)\*\*(?=\/|$)/g, '$1*');
    // Micromatch's leading **/ shortcut also accepts a root-level match.
    if (
      !ignored &&
      !negative &&
      value.startsWith('**/') &&
      !value.slice(3).includes('**/')
    ) {
      return [value.slice(3), single];
    }
    return [negative ? `!${single}` : single];
  }
  return [normalized];
}

const glob = {
  sync(patterns, options) {
    return globbySync(
      [].concat(patterns).flatMap((p) => prepare(p, options)),
      {
        expandDirectories: false,
        ...options,
        ignore: []
          .concat(options?.ignore ?? [])
          .flatMap((p) => prepare(p, options, true)),
      }
    );
  },
};
require('./glob-safety.cjs')(glob);
module.exports = glob;
