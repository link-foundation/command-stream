// Bun Shell lexer, ported from Bun's src/shell_parser/parse.rs (`Lexer`).
//
// The input is the script string assembled from a tagged template (see
// template.mjs): literal template text plus `\x08__bunstr_N\x08` placeholders
// for interpolated strings that must not be re-lexed, and `\x08__bun_N\x08`
// placeholders for interpolated JS objects (buffers, blobs, streams...).
//
// Tokens are plain objects `{ t: <tag>, ... }`. Text-like tokens carry a
// `[start, end)` range into `strpool`, the string the lexer accumulates word
// contents into. `jsStringRanges` records which strpool ranges came from
// interpolated strings, so the parser can refuse to treat them as keywords or
// assignments.

export const SPECIAL_JS_CHAR = '\x08';
export const LEX_JS_OBJREF_PREFIX = '\x08__bun_';
export const LEX_JS_STRING_PREFIX = '\x08__bunstr_';
const MAX_SUBSHELL_DEPTH = 128;

// parse.rs SPECIAL_CHARS: a string containing one of these must be passed to
// the lexer as a string ref instead of being spliced into the script.
export const SPECIAL_CHARS = new Set([
  '~',
  '[',
  ']',
  '#',
  ';',
  '\n',
  '\t',
  '\r',
  '*',
  '?',
  '{',
  ',',
  '}',
  '`',
  '$',
  '=',
  '(',
  ')',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '|',
  '>',
  '<',
  '&',
  "'",
  '"',
  ' ',
  '\\',
  SPECIAL_JS_CHAR,
]);

export const RedirectFlags = {
  STDIN: 1,
  STDOUT: 2,
  STDERR: 4,
  APPEND: 8,
  DUPLICATE_OUT: 16,
};

const NORMAL = 0;
const SINGLE = 1;
const DOUBLE = 2;

const SUB_NORMAL = 'normal';
const SUB_BACKTICK = 'backtick';
const SUB_DOLLAR = 'dollar';

const ADD_NO = 0;
const ADD_AFTER_TEXT = 1;
const ADD_AFTER_WORD = 2;

// Token tags after which a word break (AfterWord) needs an explicit Delimit.
const DELIMIT_AFTER = new Set([
  'Var',
  'VarArgv',
  'Text',
  'SingleQuotedText',
  'DoubleQuotedText',
  'BraceBegin',
  'Comma',
  'BraceEnd',
  'CmdSubstEnd',
  'Asterisk',
]);

const isDigit = (c) => c >= '0' && c <= '9';
const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** Shell character iterator (parse.rs ShellCharIter) over code points. */
class CharIter {
  constructor(cps) {
    this.cps = cps;
    this.i = 0;
    this.state = NORMAL;
    this.prev = null;
    this.current = null;
  }

  clone() {
    const c = new CharIter(this.cps);
    c.i = this.i;
    c.state = this.state;
    c.prev = this.prev;
    c.current = this.current;
    return c;
  }

  readChar() {
    const ch = this.cps[this.i];
    if (ch === undefined) {
      return null;
    }
    if (ch !== '\\' || this.state === SINGLE) {
      return { char: ch, escaped: false };
    }
    const next = this.cps[this.i + 1];
    if (next === undefined) {
      return null;
    }
    if (this.state === DOUBLE && !'$`"\\\n#'.includes(next)) {
      return { char: ch, escaped: false };
    }
    return { char: next, escaped: true };
  }

  eat() {
    const r = this.readChar();
    if (r) {
      this.prev = this.current;
      this.current = r;
      this.i += r.escaped ? 2 : 1;
    }
    return r;
  }

  peek() {
    return this.readChar();
  }

  restAtCursor(n) {
    return this.cps.slice(this.i, this.i + n).join('');
  }

  remaining() {
    return this.cps.length - this.i;
  }
}

const isWhitespace = (ic) =>
  ic.char === '\t' || ic.char === '\r' || ic.char === '\n' || ic.char === ' ';

export class Lexer {
  /**
   * @param {string|string[]} src script source (or its code points)
   * @param {string[]} stringRefs interpolated strings (`__bunstr_N`)
   * @param {number} jsobjsLen number of interpolated objects (`__bun_N`)
   */
  constructor(src, stringRefs = [], jsobjsLen = 0) {
    this.chars = new CharIter(Array.isArray(src) ? src : Array.from(src));
    this.wordStart = 0;
    this.j = 0;
    this.strpool = '';
    this.tokens = [];
    this.inSubshell = null;
    this.subshellDepth = 0;
    this.errors = [];
    this.jsStringRanges = [];
    this.stringRefs = stringRefs;
    this.jsobjsLen = jsobjsLen;
  }

  addError(msg) {
    this.errors.push(msg);
  }

  push(tok) {
    this.tokens.push(tok);
  }

  lastTokTag() {
    return this.tokens.length ? this.tokens[this.tokens.length - 1].t : null;
  }

  snapshot() {
    return { chars: this.chars.clone(), j: this.j, wordStart: this.wordStart };
  }

  backtrack(s) {
    this.chars = s.chars;
    this.j = s.j;
    this.wordStart = s.wordStart;
  }

  appendChar(c) {
    this.strpool += c;
    this.j += c.length;
  }

  eat() {
    return this.chars.eat();
  }

  peek() {
    return this.chars.peek();
  }

  /** Lex the whole input; returns false if lexing must stop (error). */
  lex() {
    for (;;) {
      const input = this.eat();
      if (!input) {
        this.breakWord(ADD_AFTER_TEXT);
        break;
      }
      const { char, escaped } = input;
      if (char === SPECIAL_JS_CHAR) {
        const r = this.lexJsRef();
        if (r === 'stop') {
          return;
        }
        if (r) {
          continue;
        }
      } else if (!escaped) {
        const r = this.lexUnescaped(input);
        if (r === 'return') {
          return;
        }
        if (r) {
          continue;
        }
      } else if (char === '\n') {
        if (this.chars.state !== DOUBLE) {
          this.breakWord(ADD_AFTER_WORD);
        }
        continue;
      }
      this.appendChar(char);
    }
    if (this.inSubshell) {
      this.addError(
        this.inSubshell === SUB_NORMAL
          ? 'Unclosed subshell'
          : 'Unclosed command substitution'
      );
      return;
    }
    this.push({ t: 'Eof' });
  }

  lexJsRef() {
    if (this.looksLike(LEX_JS_STRING_PREFIX)) {
      const idx = this.eatJsSubstitutionIdx(
        LEX_JS_STRING_PREFIX,
        'JS string ref',
        (i) => {
          if (i >= this.stringRefs.length) {
            this.addError('Invalid JS string ref (out of bounds');
            return false;
          }
          return true;
        }
      );
      if (idx !== null) {
        this.breakWord(ADD_NO);
        this.handleJsStringRef(this.stringRefs[idx]);
        return true;
      }
    } else if (this.looksLike(LEX_JS_OBJREF_PREFIX)) {
      const idx = this.eatJsSubstitutionIdx(
        LEX_JS_OBJREF_PREFIX,
        'JS object ref',
        (i) => {
          if (i >= this.jsobjsLen) {
            this.addError('Invalid JS object ref (out of bounds)');
            return false;
          }
          return true;
        }
      );
      if (idx !== null) {
        if (this.chars.state === DOUBLE) {
          this.addError('JS object reference not allowed in double quotes');
          return 'stop';
        }
        this.breakWord(ADD_NO);
        this.push({ t: 'JSObjRef', idx });
        return true;
      }
    }
    return false;
  }

  // Returns true when the char was consumed, 'return' to stop this (sub)lexer.
  lexUnescaped(input) {
    const { char } = input;
    const st = this.chars.state;
    const quoted = st === SINGLE || st === DOUBLE;
    switch (char) {
      case '[':
        return !quoted && this.lexDoubleBracket('[', 'DoubleBracketOpen');
      case ']':
        return !quoted && this.lexDoubleBracket(']', 'DoubleBracketClose');
      case '#': {
        if (quoted) {
          return false;
        }
        const prev = this.chars.prev;
        if (prev && !isWhitespace(prev)) {
          return false;
        }
        this.breakWord(ADD_AFTER_TEXT);
        this.eatComment();
        return true;
      }
      case ';':
        if (quoted) {
          return false;
        }
        this.breakWord(ADD_AFTER_TEXT);
        this.push({ t: 'Semicolon' });
        return true;
      case '\n':
        if (quoted) {
          return false;
        }
        this.breakWord(ADD_AFTER_WORD);
        this.push({ t: 'Newline' });
        return true;
      case '*': {
        if (quoted) {
          return false;
        }
        const next = this.peek();
        if (next && !next.escaped && next.char === '*') {
          this.eat();
          this.breakWord(ADD_NO);
          this.push({ t: 'DoubleAsterisk' });
          return true;
        }
        this.breakWord(ADD_NO);
        this.push({ t: 'Asterisk' });
        return true;
      }
      case '{':
      case ',':
      case '}':
        if (quoted) {
          return false;
        }
        this.breakWord(ADD_NO);
        this.push({
          t: char === '{' ? 'BraceBegin' : char === ',' ? 'Comma' : 'BraceEnd',
        });
        return true;
      case '`':
        if (st === SINGLE) {
          return false;
        }
        if (this.inSubshell === SUB_BACKTICK) {
          this.breakWord(ADD_AFTER_WORD);
          const last = this.lastTokTag();
          if (last !== null && last !== 'Delimit') {
            this.push({ t: 'Delimit' });
          }
          this.push({ t: 'CmdSubstEnd' });
          return 'return';
        }
        return this.eatSubshell(SUB_BACKTICK) ? true : 'return';
      case '$':
        if (st === SINGLE) {
          return false;
        }
        return this.lexDollar();
      case '(':
        if (quoted) {
          return false;
        }
        this.breakWord(ADD_AFTER_TEXT);
        return this.eatSubshell(SUB_NORMAL) ? true : 'return';
      case ')':
        if (quoted) {
          return false;
        }
        return this.lexCloseParen();
      case '|':
        if (quoted) {
          return false;
        }
        return this.lexPipe();
      case '>':
      case '<':
        if (quoted) {
          return false;
        }
        this.breakWord(ADD_AFTER_WORD);
        this.push({
          t: 'Redirect',
          flags: this.eatSimpleRedirect(char === '>' ? 'out' : 'in'),
        });
        return true;
      case '&':
        if (quoted) {
          return false;
        }
        return this.lexAmpersand();
      case "'":
        if (st === SINGLE) {
          this.breakWord(ADD_NO);
          this.chars.state = NORMAL;
          return true;
        }
        if (st === NORMAL) {
          this.breakWord(ADD_NO);
          this.chars.state = SINGLE;
          return true;
        }
        return false;
      case '"':
        if (st === SINGLE) {
          return false;
        }
        this.breakWord(ADD_NO);
        this.chars.state = st === NORMAL ? DOUBLE : NORMAL;
        return true;
      case ' ':
        if (st === NORMAL) {
          this.breakWord(ADD_AFTER_WORD);
          return true;
        }
        return false;
      default:
        if (isDigit(char)) {
          return this.lexDigit(input);
        }
        return false;
    }
  }

  lexDoubleBracket(ch, tag) {
    const p = this.peek();
    if (!p || p.escaped || p.char !== ch) {
      return false;
    }
    const snap = this.snapshot();
    this.eat();
    const p2 = this.peek();
    if (!p2) {
      // Both `[[` and `]]` at end of input lex as DoubleBracketClose.
      this.breakWord(ADD_AFTER_TEXT);
      this.push({ t: 'DoubleBracketClose' });
      return true;
    }
    const follow = ch === '[' ? ' \r\n\t' : ' \r\n\t;&|>';
    if (!p2.escaped && follow.includes(p2.char)) {
      this.breakWord(ADD_AFTER_TEXT);
      this.push({ t: tag });
      return true;
    }
    this.backtrack(snap);
    return false;
  }

  lexDollar() {
    const peeked = this.peek() || { char: '\0', escaped: false };
    if (!peeked.escaped && peeked.char === '(') {
      this.breakWord(ADD_NO);
      return this.eatSubshell(SUB_DOLLAR) ? true : 'return';
    }
    this.breakWord(ADD_NO);
    const [start, end] = this.eatVar();
    if (end - start === 0) {
      this.appendChar('$');
      this.breakWord(ADD_NO);
    } else if (end - start === 1 && isDigit(this.strpool[start])) {
      this.push({ t: 'VarArgv', n: Number(this.strpool[start]) });
    } else {
      this.push({ t: 'Var', start, end });
    }
    this.wordStart = this.j;
    return true;
  }

  lexCloseParen() {
    if (this.inSubshell !== SUB_DOLLAR && this.inSubshell !== SUB_NORMAL) {
      this.addError("Unexpected ')'");
      return true;
    }
    this.breakWord(ADD_AFTER_TEXT);
    if (this.inSubshell === SUB_DOLLAR) {
      const last = this.lastTokTag();
      if (
        last !== null &&
        !['Delimit', 'Semicolon', 'Eof', 'Newline'].includes(last)
      ) {
        this.push({ t: 'Delimit' });
      }
      this.push({ t: 'CmdSubstEnd' });
    } else {
      this.push({ t: 'CloseParen' });
    }
    return 'return';
  }

  lexDigit(input) {
    if (this.chars.state !== NORMAL) {
      return false;
    }
    const snap = this.snapshot();
    const flags = this.eatRedirect(input);
    if (flags !== null) {
      this.breakWord(ADD_AFTER_TEXT);
      this.push({ t: 'Redirect', flags });
      return true;
    }
    this.backtrack(snap);
    return false;
  }

  lexPipe() {
    this.breakWord(ADD_AFTER_WORD);
    const next = this.peek();
    if (!next) {
      this.addError('Unexpected EOF');
      return 'return';
    }
    if (!next.escaped && next.char === '&') {
      this.addError(
        'Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.'
      );
      return 'return';
    }
    if (next.escaped || next.char !== '|') {
      this.push({ t: 'Pipe' });
    } else {
      this.eat();
      this.push({ t: 'DoublePipe' });
    }
    return true;
  }

  lexAmpersand() {
    this.breakWord(ADD_AFTER_WORD);
    const next = this.peek();
    if (!next) {
      this.push({ t: 'Ampersand' });
      return true;
    }
    if (next.char === '>' && !next.escaped) {
      this.eat();
      const { STDOUT, STDERR, APPEND } = RedirectFlags;
      const flags = this.eatSimpleRedirectOperator('out')
        ? STDOUT | STDERR | APPEND
        : STDOUT | STDERR;
      this.push({ t: 'Redirect', flags });
    } else if (next.escaped || next.char !== '&') {
      this.push({ t: 'Ampersand' });
    } else {
      this.eat();
      this.push({ t: 'DoubleAmpersand' });
    }
    return true;
  }

  isImmediatelyEscapedQuote() {
    const { state, current, prev } = this.chars;
    const q = state === DOUBLE ? '"' : state === SINGLE ? "'" : null;
    return (
      q !== null &&
      !!current &&
      !current.escaped &&
      current.char === q &&
      !!prev &&
      !prev.escaped &&
      prev.char === q
    );
  }

  breakWord(add) {
    const start = this.wordStart;
    const end = this.j;
    if (start !== end || this.isImmediatelyEscapedQuote()) {
      const st = this.chars.state;
      const t =
        st === NORMAL
          ? 'Text'
          : st === SINGLE
            ? 'SingleQuotedText'
            : 'DoubleQuotedText';
      this.push({ t, start, end });
      if (add !== ADD_NO) {
        this.push({ t: 'Delimit' });
      }
    } else if (
      add === ADD_AFTER_WORD &&
      this.tokens.length &&
      DELIMIT_AFTER.has(this.lastTokTag())
    ) {
      this.push({ t: 'Delimit' });
    }
    this.wordStart = this.j;
  }

  eatSimpleRedirect(dir) {
    const dbl = this.eatSimpleRedirectOperator(dir);
    const { STDIN, STDOUT, APPEND } = RedirectFlags;
    if (dir === 'out') {
      return dbl ? STDOUT | APPEND : STDOUT;
    }
    return dbl ? STDIN | APPEND : STDIN;
  }

  eatSimpleRedirectOperator(dir) {
    const p = this.peek();
    if (!p || p.escaped) {
      return false;
    }
    if ((p.char === '>' && dir === 'out') || (p.char === '<' && dir === 'in')) {
      this.eat();
      return true;
    }
    return false;
  }

  eatRedirect(first) {
    const { STDIN, STDOUT, STDERR, APPEND, DUPLICATE_OUT } = RedirectFlags;
    let flags;
    if (first.char === '0') {
      flags = STDIN;
    } else if (first.char === '1') {
      flags = STDOUT;
    } else if (first.char === '2') {
      flags = STDERR;
    } else {
      return null;
    }
    const input = this.peek();
    if (!input || input.escaped) {
      return null;
    }
    if (input.char === '<') {
      if (this.eatSimpleRedirectOperator('in')) {
        flags |= APPEND;
      }
      return flags;
    }
    if (input.char !== '>') {
      return null;
    }
    this.eat();
    if (this.eatSimpleRedirectOperator('out')) {
      flags |= APPEND;
    }
    const p = this.peek();
    if (p && !p.escaped && p.char === '&') {
      this.eat();
      const p2 = this.peek();
      if (p2) {
        if (p2.char === '1') {
          this.eat();
          if (!(flags & STDOUT) && flags & STDERR) {
            flags = (flags | DUPLICATE_OUT | STDOUT) & ~STDERR;
          } else {
            return null;
          }
        } else if (p2.char === '2') {
          this.eat();
          if (!(flags & STDERR) && flags & STDOUT) {
            flags = (flags | DUPLICATE_OUT | STDERR) & ~STDOUT;
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
    }
    return flags;
  }

  eatSubshell(kind) {
    if (this.subshellDepth >= MAX_SUBSHELL_DEPTH) {
      this.addError('Subshell nesting depth exceeded');
      throw new LexDepthError();
    }
    if (kind === SUB_DOLLAR) {
      this.eat();
    }
    if (kind === SUB_NORMAL) {
      this.push({ t: 'OpenParen' });
    } else {
      this.push({ t: 'CmdSubstBegin' });
      if (this.chars.state === DOUBLE) {
        this.push({ t: 'CmdSubstQuoted' });
      }
    }
    const prevState = this.chars.state;
    const sub = Object.create(Lexer.prototype);
    Object.assign(sub, this, {
      inSubshell: kind,
      subshellDepth: this.subshellDepth + 1,
    });
    sub.chars.state = NORMAL;
    sub.lex();
    // continue_from_sublexer: the sublexer shares tokens/errors/ranges arrays;
    // copy back the scalar state it advanced.
    this.chars = sub.chars;
    this.strpool = sub.strpool;
    this.wordStart = sub.wordStart;
    this.j = sub.j;
    this.chars.state = prevState;
    return true;
  }

  handleJsStringRef(str) {
    if (str.length === 0) {
      this.push({ t: 'DoubleQuotedText', start: this.j, end: this.j });
      return;
    }
    const start = this.j;
    this.appendChar(str);
    this.jsStringRanges.push([start, this.j]);
    if (this.chars.state === NORMAL && str[0] === '~') {
      this.push({ t: 'DoubleQuotedText', start, end: this.j });
      this.wordStart = this.j;
    }
  }

  looksLike(prefix) {
    // The cursor is just past the leading \x08.
    const rest = prefix.slice(1);
    return (
      this.chars.remaining() > rest.length &&
      this.chars.restAtCursor(rest.length) === rest
    );
  }

  eatJsSubstitutionIdx(literal, name, validate) {
    const rest = literal.slice(1);
    if (this.chars.remaining() <= rest.length) {
      return null;
    }
    const cps = this.chars.cps;
    let i = this.chars.i + rest.length;
    let digits = '';
    while (i < cps.length && isDigit(cps[i])) {
      if (digits.length >= 32) {
        this.addError(`Invalid ${name} (number too high):  ${digits}${cps[i]}`);
        return null;
      }
      digits += cps[i];
      i++;
    }
    if (!digits.length) {
      this.addError(`Invalid ${name} (no idx)`);
      return null;
    }
    if (i >= cps.length || cps[i] !== SPECIAL_JS_CHAR) {
      this.addError(`Invalid ${name} (unterminated)`);
      return null;
    }
    i++;
    const idx = Number(digits);
    if (!Number.isSafeInteger(idx)) {
      this.addError(`Invalid ${name} ref `);
      return null;
    }
    if (!validate(idx)) {
      return null;
    }
    this.chars.i = i;
    this.chars.prev = { char: digits[digits.length - 1], escaped: false };
    this.chars.current = { char: SPECIAL_JS_CHAR, escaped: false };
    return idx;
  }

  eatVar() {
    const start = this.j;
    let i = 0;
    let isInt = false;
    for (let r = this.peek(); r; r = this.peek()) {
      const { char, escaped } = r;
      if (i === 0) {
        if (char === '=') {
          return [start, this.j];
        }
        if (isDigit(char)) {
          isInt = true;
          this.eat();
          this.appendChar(char);
          i++;
          continue;
        }
        if (!(isAlpha(char) || char === '_')) {
          return [start, this.j];
        }
      }
      i++;
      if (isInt) {
        return [start, this.j];
      }
      if ('{};\'" |&>,$'.includes(char)) {
        return [start, this.j];
      }
      if (
        !escaped &&
        (((this.inSubshell === SUB_DOLLAR || this.inSubshell === SUB_NORMAL) &&
          char === ')') ||
          (this.inSubshell === SUB_BACKTICK && char === '`'))
      ) {
        return [start, this.j];
      }
      if (isDigit(char) || isAlpha(char) || char === '_') {
        this.eat();
        this.appendChar(char);
      } else {
        return [start, this.j];
      }
    }
    return [start, this.j];
  }

  eatComment() {
    for (let c = this.eat(); c; c = this.eat()) {
      if (!c.escaped && c.char === '\n') {
        break;
      }
    }
  }
}

export class LexDepthError extends Error {
  constructor() {
    super('Subshell nesting depth exceeded');
    this.name = 'SubshellDepthExceeded';
  }
}

/**
 * Lex a script. Returns `{ tokens, strpool, jsStringRanges, errors }`.
 * Throws LexDepthError when subshells nest deeper than Bun allows.
 */
export function lex(src, stringRefs = [], jsobjsLen = 0) {
  const lexer = new Lexer(src, stringRefs, jsobjsLen);
  lexer.lex();
  return {
    tokens: lexer.tokens,
    strpool: lexer.strpool,
    jsStringRanges: lexer.jsStringRanges,
    errors: lexer.errors,
  };
}
