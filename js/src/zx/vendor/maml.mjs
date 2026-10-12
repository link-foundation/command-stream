// A dependency-free MAML (Minimal Abstract Markup Language) parser and
// serializer. MAML is a JSON superset with comments, unquoted keys, optional
// commas (newlines separate items) and raw multiline strings (`"""`).

const KEY_RE = /^[A-Za-z0-9_-]+$/;
const KEY_CHAR = /[A-Za-z0-9_-]/;
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD_RE = /[A-Za-z0-9_+.-]+/y;
const SIMPLE_ESCAPES = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function lineInfo(src, pos) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: pos - lineStart + 1 };
}

function describe(ch) {
  return ch === undefined ? 'end of input' : JSON.stringify(ch);
}

class MamlParser {
  constructor(source) {
    this.src = source;
    this.pos = 0;
  }

  fail(message, pos = this.pos) {
    const { line, column } = lineInfo(this.src, pos);
    const error = new SyntaxError(`${message} on line ${line}`);
    error.line = line;
    error.column = column;
    error.pos = pos;
    throw error;
  }

  unexpected() {
    this.fail(`Unexpected ${describe(this.src[this.pos])}`);
  }

  /** Skip spaces, newlines and comments; returns true if a newline was seen. */
  skip() {
    let newline = false;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '\n') {
        newline = true;
      } else if (ch === '#') {
        const eol = this.src.indexOf('\n', this.pos);
        this.pos = eol === -1 ? this.src.length : eol;
        continue;
      } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
        break;
      }
      this.pos++;
    }
    return newline;
  }

  expect(ch) {
    if (this.src[this.pos] !== ch) {
      this.fail(
        `Expected ${describe(ch)} but found ${describe(this.src[this.pos])}`
      );
    }
    this.pos++;
  }

  parseDocument() {
    this.skip();
    if (this.pos >= this.src.length) {
      this.fail('Unexpected end of input');
    }
    const value = this.parseValue();
    this.skip();
    if (this.pos < this.src.length) {
      this.unexpected();
    }
    return value;
  }

  parseValue() {
    const ch = this.src[this.pos];
    if (ch === '{') {
      return this.parseObject();
    }
    if (ch === '[') {
      return this.parseArray();
    }
    if (ch === '"') {
      return this.src.startsWith('"""', this.pos)
        ? this.parseRawString()
        : this.parseString();
    }
    return this.parseWord();
  }

  parseWord() {
    NUMBER_RE.lastIndex = this.pos;
    const num = NUMBER_RE.exec(this.src);
    WORD_RE.lastIndex = this.pos;
    const word = WORD_RE.exec(this.src);
    if (!word) {
      this.unexpected();
    }
    const text = word[0];
    const literals = { true: true, false: false, null: null };
    if (text in literals) {
      this.pos += text.length;
      return literals[text];
    }
    if (num && num[0] === text) {
      this.pos += text.length;
      return Number(text);
    }
    return this.fail(`Unexpected ${JSON.stringify(text)}`);
  }

  /**
   * Parse a sequence of items until `close`. Items are separated by a comma
   * or a newline; a trailing comma is allowed.
   */
  parseItems(close, readItem) {
    this.pos++;
    this.skip();
    while (this.src[this.pos] !== close) {
      if (this.pos >= this.src.length) {
        this.fail(`Expected ${describe(close)} but found end of input`);
      }
      readItem();
      const newline = this.skip();
      if (this.src[this.pos] === ',') {
        this.pos++;
        this.skip();
      } else if (!newline && this.src[this.pos] !== close) {
        this.unexpected();
      }
    }
    this.pos++;
  }

  parseArray() {
    const arr = [];
    this.parseItems(']', () => {
      arr.push(this.parseValue());
    });
    return arr;
  }

  parseObject() {
    const obj = {};
    this.parseItems('}', () => {
      const keyPos = this.pos;
      const key = this.parseKey();
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        this.fail(`Duplicate key ${JSON.stringify(key)}`, keyPos);
      }
      this.skipInline();
      this.expect(':');
      this.skip();
      const value = this.parseValue();
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });
    return obj;
  }

  skipInline() {
    while (this.src[this.pos] === ' ' || this.src[this.pos] === '\t') {
      this.pos++;
    }
  }

  parseKey() {
    if (this.src[this.pos] === '"') {
      return this.parseString();
    }
    const start = this.pos;
    while (this.pos < this.src.length && KEY_CHAR.test(this.src[this.pos])) {
      this.pos++;
    }
    if (start === this.pos) {
      this.unexpected();
    }
    return this.src.slice(start, this.pos);
  }

  parseString() {
    this.pos++;
    let out = '';
    for (;;) {
      const ch = this.src[this.pos];
      if (ch === undefined || ch === '\n') {
        this.fail('Unterminated string');
      }
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (ch === '\\') {
        out += this.parseEscape();
      } else if (ch < ' ' && ch !== '\t') {
        this.fail('Unexpected control character in string');
      } else {
        out += ch;
        this.pos++;
      }
    }
  }

  parseEscape() {
    const ch = this.src[this.pos + 1];
    if (ch !== undefined && SIMPLE_ESCAPES[ch] !== undefined) {
      this.pos += 2;
      return SIMPLE_ESCAPES[ch];
    }
    if (ch === 'u') {
      return this.parseUnicodeEscape();
    }
    return this.fail(`Invalid escape sequence \\${ch ?? ''}`);
  }

  parseUnicodeEscape() {
    const rest = this.src.slice(this.pos + 2);
    const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(rest);
    const plain = /^[0-9a-fA-F]{4}/.exec(rest);
    const hex = braced ? braced[1] : plain?.[0];
    const code = hex === undefined ? NaN : parseInt(hex, 16);
    if (Number.isNaN(code) || code > 0x10ffff) {
      this.fail('Invalid unicode escape sequence');
    }
    this.pos += 2 + (braced ? braced[0].length : 4);
    return String.fromCodePoint(code);
  }

  parseRawString() {
    let start = this.pos + 3;
    if (this.src[start] === '\r' && this.src[start + 1] === '\n') {
      start += 2;
    } else if (this.src[start] === '\n') {
      start += 1;
    }
    const end = this.src.indexOf('"""', start);
    if (end === -1) {
      this.fail('Unterminated multiline string');
    }
    this.pos = end + 3;
    return this.src.slice(start, end);
  }
}

/** Parse MAML text into a JavaScript value. */
export function parse(source) {
  if (typeof source !== 'string') {
    throw new TypeError('MAML source must be a string');
  }
  return new MamlParser(source).parseDocument();
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const quoteKey = (key) => (KEY_RE.test(key) ? key : JSON.stringify(key));

function stringifyString(str) {
  if (str.includes('\n') && !str.includes('"""') && !str.endsWith('"')) {
    return `"""\n${str}"""`;
  }
  return JSON.stringify(str);
}

function isSkipped(value) {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}

function stringifyPrimitive(value) {
  switch (typeof value) {
    case 'string':
      return stringifyString(value);
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null';
    case 'bigint':
      return value.toString();
    case 'boolean':
      return String(value);
    default:
      return 'null';
  }
}

function stringifyValue(input, indent, seen) {
  const value =
    input && typeof input.toJSON === 'function' ? input.toJSON() : input;
  if (value === null || typeof value !== 'object') {
    return stringifyPrimitive(value);
  }
  if (seen.has(value)) {
    throw new TypeError('Converting circular structure to MAML');
  }
  seen.add(value);
  const inner = `${indent}  `;
  let out;
  if (Array.isArray(value)) {
    const items = value.map(
      (item) =>
        `${inner}${isSkipped(item) ? 'null' : stringifyValue(item, inner, seen)}`
    );
    out = items.length ? `[\n${items.join('\n')}\n${indent}]` : '[]';
  } else {
    const entries = Object.entries(value)
      .filter(([, v]) => !isSkipped(v))
      .map(
        ([k, v]) => `${inner}${quoteKey(k)}: ${stringifyValue(v, inner, seen)}`
      );
    out = entries.length ? `{\n${entries.join('\n')}\n${indent}}` : '{}';
  }
  seen.delete(value);
  return out;
}

/** Serialize a JavaScript value as MAML text. */
export function stringify(value) {
  if (isSkipped(value)) {
    return undefined;
  }
  return stringifyValue(value, '', new Set());
}

export default { parse, stringify };
