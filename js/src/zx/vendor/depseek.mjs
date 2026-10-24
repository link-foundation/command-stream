// Dependency-free scanner that finds module specifiers (and optionally
// comments) in JS/TS sources. Mirrors the `depseek` API used by zx.

const IDENT_START_RE = /[\p{ID_Start}$_]/u;
const IDENT_PART_RE = /[\p{ID_Continue}$]/u;
const WHITESPACE_RE = /\s/;
const QUOTES = new Set(['"', "'", '`']);
// After these words a `/` starts a regular expression, not a division.
const REGEX_PREFIX_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

class Scanner {
  constructor(src, withComments) {
    this.src = src;
    this.pos = 0;
    this.tokens = [];
    this.withComments = withComments;
    // Kind of the last significant token: 'word', 'value' or a punctuator.
    this.last = '';
    this.lastWord = '';
  }

  peekNonSpace(from) {
    let i = from;
    while (i < this.src.length && WHITESPACE_RE.test(this.src[i])) {
      i++;
    }
    return i;
  }

  // Returns the end index (exclusive) of the quoted literal starting at
  // `start`, or -1 when it is not terminated.
  literalEnd(start) {
    const quote = this.src[start];
    for (let i = start + 1; i < this.src.length; i++) {
      const ch = this.src[i];
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        return i + 1;
      } else if (quote === '`' && ch === '$' && this.src[i + 1] === '{') {
        return -1;
      } else if (quote !== '`' && ch === '\n') {
        return -1;
      }
    }
    return -1;
  }

  // Reads a plain string literal at `start` if present and records it as a
  // dependency. `closing` optionally requires a following punctuator.
  tryDependency(start, closing) {
    const at = this.peekNonSpace(start);
    if (!QUOTES.has(this.src[at])) {
      return false;
    }
    const end = this.literalEnd(at);
    if (end === -1) {
      return false;
    }
    if (closing && this.src[this.peekNonSpace(end)] !== closing) {
      return false;
    }
    this.tokens.push({
      type: 'dep',
      value: this.src.slice(at + 1, end - 1),
      index: at + 1,
    });
    this.pos = end;
    this.last = 'value';
    return true;
  }

  handleKeyword(word, end) {
    if (word === 'require') {
      const paren = this.peekNonSpace(end);
      return this.src[paren] === '(' && this.tryDependency(paren + 1, ')');
    }
    if (word === 'import') {
      const next = this.peekNonSpace(end);
      if (this.src[next] === '(') {
        return this.tryDependency(next + 1, null);
      }
      return this.tryDependency(end, null);
    }
    if (word === 'from') {
      return this.tryDependency(end, null);
    }
    return false;
  }

  readWord() {
    const start = this.pos;
    let end = start + 1;
    while (end < this.src.length && IDENT_PART_RE.test(this.src[end])) {
      end++;
    }
    const word = this.src.slice(start, end);
    const isMember = this.src[start - 1] === '.' && this.src[start - 2] !== '.';
    this.pos = end;
    if (!isMember && this.handleKeyword(word, end)) {
      return;
    }
    this.last = 'word';
    this.lastWord = word;
  }

  readComment(block) {
    const bodyStart = this.pos + 2;
    let end;
    let next;
    if (block) {
      end = this.src.indexOf('*/', bodyStart);
      end = end === -1 ? this.src.length : end;
      next = Math.min(end + 2, this.src.length);
    } else {
      const lineEnd = this.src.slice(bodyStart).search(/\r?\n/);
      end = lineEnd === -1 ? this.src.length : bodyStart + lineEnd;
      next = end;
    }
    if (this.withComments) {
      this.tokens.push({
        type: 'comment',
        value: this.src.slice(bodyStart, end),
        index: bodyStart,
      });
    }
    this.pos = next;
  }

  skipString() {
    const end = this.literalEnd(this.pos);
    if (end === -1) {
      const lineEnd = this.src.indexOf('\n', this.pos + 1);
      this.pos = lineEnd === -1 ? this.src.length : lineEnd;
    } else {
      this.pos = end;
    }
    this.last = 'value';
  }

  // Skips a template literal, scanning `${...}` expressions as code.
  skipTemplate() {
    this.pos++;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '\\') {
        this.pos += 2;
      } else if (ch === '`') {
        this.pos++;
        break;
      } else if (ch === '$' && this.src[this.pos + 1] === '{') {
        this.pos += 2;
        this.scan(true);
        this.pos++;
      } else {
        this.pos++;
      }
    }
    this.last = 'value';
  }

  regexAllowed() {
    if (this.last === 'value') {
      return false;
    }
    if (this.last === 'word') {
      return REGEX_PREFIX_WORDS.has(this.lastWord);
    }
    return this.last !== ')' && this.last !== ']' && this.last !== '}';
  }

  skipRegex() {
    let inClass = false;
    for (let i = this.pos + 1; i < this.src.length; i++) {
      const ch = this.src[i];
      if (ch === '\\') {
        i++;
      } else if (ch === '\n') {
        break;
      } else if (ch === '[' || ch === ']') {
        inClass = ch === '[';
      } else if (ch === '/' && !inClass) {
        this.pos = i + 1;
        this.last = 'value';
        return;
      }
    }
    // Not a regex after all: treat the slash as a division operator.
    this.pos++;
    this.last = '/';
  }

  handleSlash() {
    const next = this.src[this.pos + 1];
    if (next === '/' || next === '*') {
      this.readComment(next === '*');
    } else if (this.regexAllowed()) {
      this.skipRegex();
    } else {
      this.pos++;
      this.last = '/';
    }
  }

  skipNumber() {
    while (this.pos < this.src.length && /[\w.]/.test(this.src[this.pos])) {
      this.pos++;
    }
    this.last = 'value';
  }

  // Returns the updated brace depth and whether to stop at a closing brace.
  handlePunctuator(ch, depth, untilBrace) {
    this.pos++;
    this.last = ch;
    if (ch === '{') {
      return { depth: depth + 1, stop: false };
    }
    if (ch === '}') {
      if (depth === 0 && untilBrace) {
        this.pos--;
        return { depth, stop: true };
      }
      return { depth: depth - 1, stop: false };
    }
    return { depth, stop: false };
  }

  scan(untilBrace = false) {
    let depth = 0;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (WHITESPACE_RE.test(ch)) {
        this.pos++;
      } else if (ch === '/') {
        this.handleSlash();
      } else if (ch === '`') {
        this.skipTemplate();
      } else if (QUOTES.has(ch)) {
        this.skipString();
      } else if (/\d/.test(ch)) {
        this.skipNumber();
      } else if (IDENT_START_RE.test(ch)) {
        this.readWord();
      } else {
        const state = this.handlePunctuator(ch, depth, untilBrace);
        if (state.stop) {
          return;
        }
        depth = state.depth;
      }
    }
  }
}

/**
 * Find module specifiers (and optionally comments) in JS/TS source code.
 * @param {string} content
 * @param {{ comments?: boolean }} [opts]
 * @returns {Array<{ type: 'dep'|'comment', value: string, index: number }>}
 */
export function depseekSync(content, opts = {}) {
  const src = String(content ?? '');
  const scanner = new Scanner(src, Boolean(opts && opts.comments));
  if (src.startsWith('#!')) {
    const lineEnd = src.indexOf('\n');
    scanner.pos = lineEnd === -1 ? src.length : lineEnd;
  }
  scanner.scan();
  return scanner.tokens;
}

export const depseek = depseekSync;

export default { depseekSync, depseek };
