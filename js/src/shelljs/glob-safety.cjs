'use strict';

// GHSA-vfj7-8cjw-p6xm has no patched braces release. ShellJS catches errors
// during argument expansion, but its recursive ls path also calls glob.sync
// directly. Guard that shared dependency before either path reaches braces.
const MAX_DEPTH = 100;
const MAX_LENGTH = 10000;
const guarded = Symbol.for('command-stream.shelljs.glob-depth-guard');

function checkPattern(pattern) {
  // Preserve fast-glob's validation of non-string arguments.
  if (typeof pattern !== 'string') {
    return;
  }
  if (pattern.length > MAX_LENGTH) {
    throw new SyntaxError('ShellJS glob exceeds 10000 characters');
  }
  const stack = [];
  let quote = '';
  let brackets = 0;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '\\') {
      index++;
    } else if (quote) {
      if (char === quote) {
        quote = '';
      }
    } else if (brackets) {
      if (char === '[') {
        brackets++;
      }
      if (char === ']') {
        brackets--;
      }
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '[') {
      brackets = 1;
    } else if (char === '{' || char === '(') {
      stack.push(char);
      if (stack.length > MAX_DEPTH) {
        const error = new SyntaxError(
          'ShellJS glob nesting exceeds 100 levels'
        );
        error.code = 'ERR_SHELLJS_GLOB_DEPTH';
        throw error;
      }
    } else if (
      (char === '}' && stack.at(-1) === '{') ||
      (char === ')' && stack.at(-1) === '(')
    ) {
      stack.pop();
    }
  }
}

module.exports = function guardShellJsGlob(glob) {
  if (glob.sync[guarded]) {
    return;
  }
  const original = glob.sync;
  function sync(patterns, options) {
    for (const pattern of [].concat(patterns)) {
      checkPattern(pattern);
    }
    for (const pattern of [].concat(options?.ignore ?? [])) {
      checkPattern(pattern);
    }
    return original.call(this, patterns, options);
  }
  Object.defineProperty(sync, guarded, { value: true });
  // ShellJS loads sync through this property for both expansion and ls -R.
  // Apply both aliases so other callers sharing this dependency get the guard.
  glob.sync = sync;
  glob.globSync = sync;
};
