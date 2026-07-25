// Shell lexer for the $fy translator.
//
// Produces a flat, lossless token stream: every character of the input ends up
// in exactly one token's `raw`, so the formalizer can rebuild the original
// source from the links network.

const REDIRECT = /^(\d*)(>>|>&|>|<<<|<<|<)/;
const OPERATORS = ['&&', '||', ';;', ';', '|', '(', ')'];
const WORD_TERMINATORS = new Set([
  ' ',
  '\t',
  '\n',
  ';',
  '|',
  '&',
  '(',
  ')',
  '<',
  '>',
]);

/** Token types emitted by {@link tokenize}. */
export const TokenType = Object.freeze({
  WORD: 'word',
  OPERATOR: 'operator',
  REDIRECT: 'redirect',
  NEWLINE: 'newline',
  COMMENT: 'comment',
  EOF: 'eof',
});

/**
 * Consumes a balanced span that starts at `start` (e.g. `$(`, `${`).
 * Returns the index just past the closing delimiter.
 */
function readBalanced(source, start, open, close) {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
}

/** Consumes a quoted span including both quote characters. */
function readQuoted(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (quote === '"' && character === '\\') {
      index += 2;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

/**
 * Reads one shell word starting at `start`, treating quotes, `$(...)`,
 * `${...}` and backticks as atomic spans.
 */
function readWord(source, start) {
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === "'" || character === '"') {
      index = readQuoted(source, index, character);
      continue;
    }
    if (character === '`') {
      index = readQuoted(source, index, '`');
      continue;
    }
    if (character === '$' && source[index + 1] === '(') {
      index = readBalanced(source, index + 1, '(', ')');
      continue;
    }
    if (character === '$' && source[index + 1] === '{') {
      index = readBalanced(source, index + 1, '{', '}');
      continue;
    }
    if (WORD_TERMINATORS.has(character)) {
      break;
    }
    index += 1;
  }
  return { text: source.slice(start, index), next: index };
}

/**
 * A redirection operator may be prefixed by a file descriptor (`2>`). Only
 * treat a leading run of digits as part of the operator, never as a word.
 */
function matchRedirect(source, index) {
  const match = REDIRECT.exec(source.slice(index));
  return match ? match[0] : undefined;
}

function matchOperator(source, index) {
  return OPERATORS.find((operator) => source.startsWith(operator, index));
}

/**
 * Matches whitespace, line splices, newlines and comments.
 *
 * @returns {{token: object | null, next: number} | null} The token to emit (or
 *   `null` to emit nothing) and the index to continue from, or `null` when the
 *   character starts a word or operator instead.
 */
function matchTrivia(source, index) {
  const character = source[index];

  if (character === '\n') {
    return { token: { type: TokenType.NEWLINE, text: '\n' }, next: index + 1 };
  }
  if (character === ' ' || character === '\t' || character === '\r') {
    return { token: null, next: index + 1 };
  }
  // A backslash-newline pair splices two physical lines into one.
  if (character === '\\' && source[index + 1] === '\n') {
    return { token: null, next: index + 2 };
  }
  // `#` only opens a comment at the start of a word.
  if (
    character === '#' &&
    (index === 0 || /[\s;|&()]/.test(source[index - 1]))
  ) {
    let end = source.indexOf('\n', index);
    if (end === -1) {
      end = source.length;
    }
    const text = source.slice(index, end);
    return { token: { type: TokenType.COMMENT, text }, next: end };
  }
  return null;
}

/**
 * Tokenizes a complete shell script.
 *
 * @param {string} source Shell source text.
 * @returns {Array<{type: string, text: string}>} Tokens, ending with an EOF token.
 */
export function tokenize(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    const trivia = matchTrivia(source, index);
    if (trivia) {
      if (trivia.token) {
        tokens.push(trivia.token);
      }
      index = trivia.next;
      continue;
    }

    const redirect = matchRedirect(source, index);
    if (redirect) {
      tokens.push({ type: TokenType.REDIRECT, text: redirect });
      index += redirect.length;
      continue;
    }
    // `&` on its own backgrounds a command; `&&` was matched by the operator list.
    const operator =
      matchOperator(source, index) ?? (character === '&' ? '&' : undefined);
    if (operator) {
      tokens.push({ type: TokenType.OPERATOR, text: operator });
      index += operator.length;
      continue;
    }

    const { text, next } = readWord(source, index);
    if (text === '') {
      index += 1;
      continue;
    }
    tokens.push({ type: TokenType.WORD, text });
    index = next;
  }

  tokens.push({ type: TokenType.EOF, text: '' });
  return tokens;
}
