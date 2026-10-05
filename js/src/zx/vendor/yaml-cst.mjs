// Simplified streaming layer: Lexer, Parser, Composer and a CST helper
// namespace. The tokens are lossless: concatenating the source of every
// token yields the original input.

import { composeDocuments } from './yaml-compose-docs.mjs';

const TOKEN_RE =
  /\r?\n|[ \t]+|#[^\n]*|[-?:](?=[ \t\n]|$)|[[\]{},]|[&*!][^ \t\n,[\]{}]*|"(?:[^"\\]|\\[^])*"?|'(?:[^']|'')*'?|[^ \t\n,[\]{}#]+(?:[ \t]*[^ \t\n,[\]{}#:]+|:[^ \t\n,[\]{}])*/gy;

/** Tokenises YAML source into lossless string tokens. */
export class Lexer {
  *lex(source, incomplete = false) {
    const src = String(source ?? '');
    let pos = 0;
    while (pos < src.length) {
      TOKEN_RE.lastIndex = pos;
      const m = TOKEN_RE.exec(src);
      const tok = m && m[0] ? m[0] : src[pos];
      pos += tok.length;
      yield tok;
    }
    if (!incomplete && src.length === 0) {
      return;
    }
  }
}

const isMarkerLine = (line) => /^(?:---|\.\.\.)(?:[ \t\r\n]|$)/.test(line);

function scalarToken(offset, source) {
  let type = 'scalar';
  if (source[0] === '"') {
    type = 'double-quoted-scalar';
  } else if (source[0] === "'") {
    type = 'single-quoted-scalar';
  } else if (source[0] === '|' || source[0] === '>') {
    type = 'block-scalar';
  }
  return { type, offset, indent: 0, source };
}

/**
 * Splits a YAML stream into `directive` and `document` CST tokens. Each
 * token has `type`, `offset` and `source` (its full raw text).
 */
export class Parser {
  constructor(onNewLine) {
    this.onNewLine = typeof onNewLine === 'function' ? onNewLine : null;
  }

  *parse(source, incomplete = false) {
    const src = String(source ?? '');
    if (this.onNewLine) {
      this.onNewLine(0);
      for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) {
        this.onNewLine(i + 1);
      }
    }
    let doc = null;
    let pos = 0;
    const flush = () => {
      if (doc) {
        doc.value = scalarToken(doc.offset, doc.source);
        const out = doc;
        doc = null;
        return out;
      }
      return null;
    };
    for (const line of src.split(/(?<=\n)/)) {
      if (line[0] === '%' && !doc) {
        yield { type: 'directive', offset: pos, source: line };
      } else if (isMarkerLine(line) && line.startsWith('---')) {
        const done = flush();
        if (done) {
          yield done;
        }
        doc = { type: 'document', offset: pos, start: [], source: line };
      } else if (doc) {
        doc.source += line;
      } else {
        doc = { type: 'document', offset: pos, start: [], source: line };
      }
      pos += line.length;
    }
    const last = flush();
    if (last && !incomplete) {
      yield last;
    }
  }
}

/** Composes CST tokens (from Parser#parse) into Document instances. */
export class Composer {
  constructor(options = {}) {
    this.options = options;
    this.parts = [];
  }

  *compose(tokens, forceDoc = false, endOffset = -1) {
    for (const token of tokens) {
      yield* this.next(token);
    }
    yield* this.end(forceDoc, endOffset);
  }

  *next(token) {
    if (token && typeof token.source === 'string') {
      this.parts.push(token.source);
    }
    yield* [];
  }

  *end(forceDoc = false, _endOffset = -1) {
    const source = this.parts.join('');
    this.parts = [];
    const { docs } = composeDocuments(source, this.options);
    if (docs.length === 0 && forceDoc) {
      const { docs: forced } = composeDocuments('---\n', this.options);
      forced[0].directives.docStart = null;
      forced[0].contents = null;
      yield forced[0];
      return;
    }
    yield* docs;
  }
}

function cstVisit(cst, visitor) {
  const walk = (token, path) => {
    const ctrl = visitor(token, path);
    if (typeof ctrl === 'symbol') {
      return ctrl;
    }
    for (const key of ['start', 'items']) {
      if (Array.isArray(token[key])) {
        for (const child of token[key]) {
          if (walk(child, path.concat(token)) === cstVisit.BREAK) {
            return cstVisit.BREAK;
          }
        }
      }
    }
    if (token.value && typeof token.value === 'object') {
      return walk(token.value, path.concat(token));
    }
    return undefined;
  };
  walk(cst, []);
}
cstVisit.BREAK = Symbol('break visit');
cstVisit.SKIP = Symbol('skip children');
cstVisit.REMOVE = Symbol('remove item');

const SCALAR_TYPES = new Set([
  'alias',
  'scalar',
  'single-quoted-scalar',
  'double-quoted-scalar',
  'block-scalar',
]);
const COLLECTION_TYPES = new Set(['block-map', 'block-seq', 'flow-collection']);

/** Minimal CST helper namespace. */
export const CST = Object.freeze({
  BOM: '\u{FEFF}',
  DOCUMENT: '\x02',
  FLOW_END: '\x18',
  SCALAR: '\x1f',
  isCollection: (token) => !!token && COLLECTION_TYPES.has(token.type),
  isScalar: (token) => !!token && SCALAR_TYPES.has(token.type),
  stringify: (token) => (token && token.source) || '',
  visit: cstVisit,
});
