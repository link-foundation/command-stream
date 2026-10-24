// YAML text -> node tree. A recursive-descent composer working directly on
// the source text of a single document.

import { YAMLParseError, YAMLWarning } from './yaml-errors.mjs';
import {
  Alias,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isCollection,
  isPair,
  isScalar,
} from './yaml-nodes.mjs';
import {
  isWs,
  isWsOrEnd,
  readBlockScalar,
  readDoubleQuoted,
  readPlain,
  readSingleQuoted,
} from './yaml-compose-scalar.mjs';

const FLOW_CHARS = ',[]{}';
const isFlowChar = (c) => c !== undefined && FLOW_CHARS.includes(c);

function prependComment(existing, text) {
  return existing ? `${text}\n${existing}` : text;
}

/** Attach an own-line comment before `node` (or its first block item). */
export function attachCommentBefore(node, text) {
  if (text === null || text === undefined) {
    return;
  }
  let target = node;
  if (isCollection(node) && !node.flow && node.items.length > 0) {
    const first = node.items[0];
    target = isPair(first) ? first.key : first;
  }
  if (target && typeof target === 'object') {
    target.commentBefore = prependComment(target.commentBefore, text);
  }
}

function joinComments(comments) {
  return comments.length ? comments.map((c) => c.text).join('\n') : null;
}

function keysEqual(a, b) {
  if (a === b) {
    return true;
  }
  return isScalar(a) && isScalar(b) && a.value === b.value;
}

export class NodeComposer {
  constructor(src, start, end, doc) {
    this.src = src;
    this.pos = start;
    this.end = end;
    this.doc = doc;
    this.flowDepth = 0;
    this.flowIndent = -1;
    this.quoteIndent = -1;
    this.raw = new WeakMap();
  }

  // -------------------------------------------------------------------------
  // Low-level helpers
  // -------------------------------------------------------------------------

  error(code, message, pos = this.pos, len = 1) {
    throw new YAMLParseError([pos, pos + len], code, message);
  }

  softError(code, message, pos, len = 1) {
    this.doc.errors.push(new YAMLParseError([pos, pos + len], code, message));
  }

  warn(code, message, pos, len = 1) {
    this.doc.warnings.push(new YAMLWarning([pos, pos + len], code, message));
  }

  lineStart(pos = this.pos) {
    return this.src.lastIndexOf('\n', pos - 1) + 1;
  }

  col(pos = this.pos) {
    return pos - (this.src.lastIndexOf('\n', pos - 1) + 1);
  }

  peek(offset = 0) {
    const i = this.pos + offset;
    return i < this.end ? this.src[i] : undefined;
  }

  isIndicator(ch) {
    return this.peek() === ch && isWsOrEnd(this.peek(1));
  }

  lineEnd(pos) {
    const i = this.src.indexOf('\n', pos);
    return i === -1 || i > this.end ? this.end : i;
  }

  skipInline() {
    while (this.pos < this.end && isWs(this.src[this.pos])) {
      this.pos++;
    }
  }

  atLineEnd() {
    const c = this.peek();
    return c === undefined || c === '\n';
  }

  readComment() {
    const eol = this.lineEnd(this.pos);
    const text = this.src.slice(this.pos + 1, eol).replace(/\r$/, '');
    this.pos = eol;
    return text;
  }

  isBlankLineBefore(pos) {
    const start = this.src.lastIndexOf('\n', pos - 1) + 1;
    return /^[ \t\r]*$/.test(this.src.slice(start, pos));
  }

  /**
   * Skip whitespace, line breaks and comments. Returns collected comments,
   * whether blank lines were seen and whether content was found.
   */
  skipToContent() {
    const comments = [];
    let spaceBefore = false;
    let blankAfterComment = false;
    let lines = 0;
    while (this.pos < this.end) {
      const c = this.src[this.pos];
      if (c === '\n') {
        if (lines > 0 && this.isBlankLineBefore(this.pos)) {
          spaceBefore = true;
          blankAfterComment = comments.length > 0;
        }
        lines++;
        this.pos++;
      } else if (isWs(c) || c === '\r') {
        this.pos++;
      } else if (c === '#' && (this.pos === 0 || this.isAfterSpace())) {
        const lineStart = this.src.lastIndexOf('\n', this.pos - 1) + 1;
        const col = this.pos - lineStart;
        const text = this.readComment();
        comments.push({ text, col, lineStart, lineEnd: this.pos });
        blankAfterComment = false;
      } else {
        break;
      }
    }
    const found = this.pos < this.end;
    return {
      comments,
      spaceBefore,
      blankAfterComment,
      found,
      newLine: lines > 0,
      col: this.col(),
    };
  }

  isAfterSpace() {
    const prev = this.src[this.pos - 1];
    return prev === undefined || isWs(prev) || prev === '\n';
  }

  // -------------------------------------------------------------------------
  // Node construction helpers
  // -------------------------------------------------------------------------

  emptyScalar(pos) {
    const node = new Scalar(null);
    node.range = [pos, pos, pos];
    node.source = '';
    this.raw.set(node, '');
    return node;
  }

  resolveOptions() {
    return { intAsBigInt: this.doc.options.intAsBigInt === true };
  }

  applyScalarResult(node, res) {
    node.value = res.value;
    if (res.format) {
      node.format = res.format;
    }
    if (res.minFractionDigits) {
      node.minFractionDigits = res.minFractionDigits;
    }
  }

  /** Resolve a scalar's value according to its tag or the schema. */
  resolveScalar(node, str, plain, tag, tagRange = null) {
    const { schema } = this.doc;
    if (!tag || tag === '!') {
      const res =
        plain && !tag ? schema.resolvePlain(str, this.resolveOptions()) : null;
      if (res) {
        this.applyScalarResult(node, res);
      } else {
        node.value = str;
      }
      return;
    }
    const res = schema.resolveTagged(tag, str, this.resolveOptions());
    if (res) {
      this.applyScalarResult(node, res);
    } else {
      const [from, to] = tagRange || [node.range[0], node.range[0] + 1];
      this.warn(
        'TAG_RESOLVE_FAILED',
        `Unresolved tag: ${tag}`,
        from,
        to - from
      );
      node.value = str;
    }
  }

  applyProps(node, props) {
    if (props.anchor) {
      node.anchor = props.anchor;
    }
    if (props.tag) {
      node.tag = props.tag;
      if (this.raw.has(node)) {
        const plain = node.type === 'PLAIN';
        const raw = this.raw.get(node);
        this.resolveScalar(node, raw, plain, props.tag, props.tagRange);
      }
    }
    if (node.range && props.start < node.range[0]) {
      node.range[0] = props.start;
    }
    return node;
  }

  resolveTagHandle(token, pos) {
    if (token === '!') {
      return '!';
    }
    if (token.startsWith('!<')) {
      if (!token.endsWith('>')) {
        this.error('MISSING_CHAR', 'Verbatim tags must end with a >', pos);
      }
      return token.slice(2, -1);
    }
    const m = /^(![\w-]*!)(.*)$/.exec(token);
    const { tags } = this.doc.directives;
    let res;
    if (m) {
      if (!(m[1] in tags)) {
        this.error(
          'MISSING_TAG_HANDLE',
          `Could not resolve tag: ${token}`,
          pos
        );
      }
      res = tags[m[1]] + m[2];
    } else {
      res = tags['!'] ? tags['!'] + token.slice(1) : token;
    }
    try {
      return decodeURIComponent(res);
    } catch {
      return res;
    }
  }

  readPropToken() {
    const start = this.pos;
    while (this.pos < this.end) {
      const c = this.src[this.pos];
      if (isWsOrEnd(c) || c === '\r' || (this.flowDepth && isFlowChar(c))) {
        break;
      }
      this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  /** Read optional anchor and tag properties. */
  readProps() {
    const props = { anchor: null, tag: null, start: this.pos, any: false };
    for (;;) {
      const c = this.peek();
      const at = this.pos;
      if (c === '&' && !props.anchor) {
        props.anchor = this.readPropToken().slice(1);
        if (!props.anchor) {
          this.error('BAD_ALIAS', 'Anchor name must not be empty', at);
        }
      } else if (c === '!' && !props.tag) {
        const token = this.readPropToken();
        props.tag = this.resolveTagHandle(token, at);
        props.tagRange = [at, at + token.length];
      } else {
        break;
      }
      props.any = true;
      this.skipInline();
    }
    return props;
  }

  // -------------------------------------------------------------------------
  // Inline (single node) parsing
  // -------------------------------------------------------------------------

  parseAlias() {
    const start = this.pos;
    const name = this.readPropToken().slice(1);
    if (!name) {
      this.error('BAD_ALIAS', 'Alias name must not be empty', start);
    }
    const node = new Alias(name);
    node.range = [start, this.pos, this.pos];
    return node;
  }

  quotedScalar(start, parentIndent, double) {
    this.quoteIndent = parentIndent;
    const value = double ? readDoubleQuoted(this) : readSingleQuoted(this);
    const node = new Scalar(value);
    node.type = double ? 'QUOTE_DOUBLE' : 'QUOTE_SINGLE';
    node.range = [start, this.pos, this.pos];
    this.raw.set(node, value);
    return node;
  }

  blockScalar(start, parentIndent) {
    const { value, header } = readBlockScalar(this, parentIndent);
    const node = new Scalar(value);
    node.type = header.literal ? 'BLOCK_LITERAL' : 'BLOCK_FOLDED';
    node.range = [start, this.pos, this.pos];
    this.raw.set(node, value);
    if (header.comment !== undefined) {
      node.comment = header.comment;
    }
    return node;
  }

  plainScalar(start, parentIndent) {
    const c = this.peek();
    if (c === '@' || c === '`') {
      this.error(
        'BAD_SCALAR_START',
        `Plain value cannot start with reserved character ${c}`,
        start
      );
    }
    const inFlow = this.flowDepth > 0;
    const text = readPlain(
      this,
      inFlow ? this.flowIndent : parentIndent,
      inFlow
    );
    if (text === '') {
      this.error('UNEXPECTED_TOKEN', `Unexpected ${JSON.stringify(c)}`, start);
    }
    const node = new Scalar(text);
    node.type = 'PLAIN';
    node.range = [start, this.pos, this.pos];
    node.source = text;
    this.raw.set(node, text);
    this.resolveScalar(node, text, true, null);
    return node;
  }

  /** Parse an alias, flow collection or scalar at the current position. */
  parseInline(parentIndent) {
    const start = this.pos;
    const c = this.peek();
    if (c === '*') {
      return this.parseAlias();
    }
    if (c === '[' || c === '{') {
      return this.parseFlow(parentIndent);
    }
    if (c === '"' || c === "'") {
      return this.quotedScalar(start, parentIndent, c === '"');
    }
    if ((c === '|' || c === '>') && this.flowDepth === 0) {
      return this.blockScalar(start, parentIndent);
    }
    return this.plainScalar(start, parentIndent);
  }

  /** Inline node including its properties; missing content gives null. */
  parseInlineWithProps(parentIndent) {
    const props = this.readProps();
    const c = this.peek();
    let node;
    if (
      props.any &&
      (this.atLineEnd() || c === '#' || (this.flowDepth && isFlowChar(c)))
    ) {
      node = this.emptyScalar(this.pos);
    } else {
      node = this.parseInline(parentIndent);
    }
    return this.applyProps(node, props);
  }

  // -------------------------------------------------------------------------
  // Block collections
  // -------------------------------------------------------------------------

  isMultiLine(node) {
    const [from, to] = node.range;
    return this.src.slice(from, to).includes('\n');
  }

  /** Parse a node in block context at the current (content) position. */
  parseBlockNode(parentIndent, compact, sameIndentSeq = false) {
    const start = this.pos;
    const col = this.col(start);
    if (this.isIndicator('-')) {
      if (!compact) {
        this.error(
          'UNEXPECTED_TOKEN',
          'Unexpected block-seq-ind on same line with key'
        );
      }
      return this.parseBlockSeq(col);
    }
    if (this.isIndicator('?') || this.isIndicator(':')) {
      if (!compact) {
        this.error(
          'BLOCK_AS_IMPLICIT_KEY',
          'Nested mappings are not allowed in compact mappings'
        );
      }
      return this.parseBlockMap(col, null);
    }
    const props = this.readProps();
    if (props.any && (this.atLineEnd() || this.peek() === '#')) {
      const node = this.parseBlockValue(parentIndent, true, sameIndentSeq);
      return this.applyProps(node, props);
    }
    const node = this.parseInline(parentIndent);
    this.applyProps(node, props);
    const save = this.pos;
    this.skipInline();
    if (this.isIndicator(':')) {
      if (!compact) {
        this.error(
          'BLOCK_AS_IMPLICIT_KEY',
          'Nested mappings are not allowed in compact mappings',
          start
        );
      }
      this.checkImplicitKey(node, start);
      return this.parseBlockMap(col, node);
    }
    this.pos = save;
    return node;
  }

  checkImplicitKey(node, start) {
    if (this.isMultiLine(node)) {
      this.error(
        'MULTILINE_IMPLICIT_KEY',
        'Implicit keys need to be on a single line',
        start
      );
    }
    if (isScalar(node) && /^BLOCK_/.test(node.type)) {
      this.error(
        'BLOCK_AS_IMPLICIT_KEY',
        'Block scalars cannot be used as implicit keys',
        start
      );
    }
  }

  /**
   * Parse the value following an indicator (`key:`, `- `, `? `). The value
   * may be on the same line or on following, more indented lines.
   */
  parseBlockValue(indent, compact, sameIndentSeq = false) {
    this.skipInline();
    let comment = null;
    if (this.peek() === '#') {
      comment = this.readComment();
    }
    if (!this.atLineEnd()) {
      return this.parseBlockNode(indent, compact, sameIndentSeq);
    }
    const save = this.pos;
    const info = this.skipToContent();
    const deeper =
      info.found &&
      (info.col > indent ||
        (sameIndentSeq && info.col === indent && this.isIndicator('-')));
    if (!deeper) {
      this.pos = save;
      const empty = this.emptyScalar(save);
      if (comment !== null) {
        empty.comment = comment;
      }
      return empty;
    }
    const node = this.parseBlockNode(indent, true);
    attachCommentBefore(node, joinComments(info.comments));
    attachCommentBefore(node, comment);
    return node;
  }

  /** Check for trailing content / comment after a node on its last line. */
  endOfNodeLine(node) {
    this.skipInline();
    if (this.peek() === '#' && this.isAfterSpace()) {
      const text = this.readComment();
      if (isScalar(node) || isCollection(node)) {
        node.comment = prependComment(node.comment, text);
      }
      return;
    }
    if (!this.atLineEnd()) {
      this.error('UNEXPECTED_TOKEN', 'Unexpected scalar at node end');
    }
  }

  /** Decide where comments between the last item and a dedent belong. */
  finishCollection(node, info, save, indent) {
    let taken = 0;
    if (info.found) {
      while (
        taken < info.comments.length &&
        info.comments[taken].col >= indent &&
        info.comments[taken].col > 0
      ) {
        taken++;
      }
    }
    if (taken > 0) {
      node.comment = joinComments(info.comments.slice(0, taken));
    }
    if (taken === 0) {
      this.pos = save;
    } else if (taken < info.comments.length) {
      this.pos = info.comments[taken].lineStart;
    } else {
      this.pos = info.comments[taken - 1].lineEnd;
    }
    node.range[1] = save;
    node.range[2] = save;
  }

  decorate(node, info) {
    if (!info) {
      return;
    }
    attachCommentBefore(node, joinComments(info.comments));
    if (info.spaceBefore) {
      node.spaceBefore = true;
    }
  }

  addPair(map, pair) {
    if (this.doc.options.uniqueKeys !== false) {
      const isMerge =
        this.doc.schema.merge && isScalar(pair.key) && pair.key.value === '<<';
      const dup =
        !isMerge && map.items.some((item) => keysEqual(item.key, pair.key));
      if (dup) {
        const at = pair.key?.range ? pair.key.range[0] : this.pos;
        this.softError('DUPLICATE_KEY', 'Map keys must be unique', at);
      }
    }
    map.items.push(pair);
  }

  parseBlockSeq(indent) {
    const seq = new YAMLSeq(this.doc.schema);
    seq.range = [this.pos, this.pos, this.pos];
    let pending = null;
    for (;;) {
      this.pos++;
      const item = this.parseBlockValue(indent, true);
      this.decorate(item, pending);
      seq.items.push(item);
      this.endOfNodeLine(item);
      const save = this.pos;
      const info = this.skipToContent();
      if (!info.found || info.col < indent || !this.isIndicator('-')) {
        if (info.found && info.col > indent) {
          this.error(
            'BAD_INDENT',
            'All sequence items must start at the same column',
            this.lineStart()
          );
        }
        this.finishCollection(seq, info, save, indent);
        return seq;
      }
      if (info.col > indent) {
        this.error(
          'BAD_INDENT',
          'All sequence items must start at the same column',
          this.lineStart()
        );
      }
      pending = info;
    }
  }

  /** Parse an explicit `? key` entry, returning a Pair. */
  parseExplicitPair(indent) {
    this.pos++;
    const key = this.parseBlockValue(indent, true);
    this.endOfNodeLine(key);
    const save = this.pos;
    const info = this.skipToContent();
    if (info.found && info.col === indent && this.isIndicator(':')) {
      this.pos++;
      const value = this.parseBlockValue(indent, true);
      attachCommentBefore(value, joinComments(info.comments));
      return new Pair(key, value);
    }
    this.pos = save;
    return new Pair(key, null);
  }

  /** Parse an implicit `key: value` entry, returning a Pair. */
  parseImplicitPair(indent, key) {
    let k = key;
    if (!k) {
      const start = this.pos;
      if (this.isIndicator(':')) {
        k = this.emptyScalar(start);
      } else {
        k = this.parseInlineWithProps(indent);
        this.skipInline();
        if (!this.isIndicator(':')) {
          this.error(
            'MISSING_CHAR',
            'Implicit map keys need to be followed by map values',
            start
          );
        }
        this.checkImplicitKey(k, start);
      }
    }
    this.pos++;
    const value = this.parseBlockValue(indent, false, true);
    return new Pair(k, value);
  }

  parseBlockMap(indent, firstKey) {
    const map = new YAMLMap(this.doc.schema);
    const start = firstKey?.range ? firstKey.range[0] : this.pos;
    map.range = [start, start, start];
    let key = firstKey;
    let pending = null;
    for (;;) {
      const pair =
        !key && this.isIndicator('?')
          ? this.parseExplicitPair(indent)
          : this.parseImplicitPair(indent, key);
      this.decorate(pair.key, pending);
      this.addPair(map, pair);
      this.endOfNodeLine(pair.value ?? pair.key);
      const save = this.pos;
      const info = this.skipToContent();
      if (!info.found || info.col < indent) {
        this.finishCollection(map, info, save, indent);
        return map;
      }
      if (info.col > indent) {
        this.error(
          'BAD_INDENT',
          'All mapping items must start at the same column',
          this.lineStart()
        );
      }
      if (this.isIndicator('-')) {
        this.error(
          'UNEXPECTED_TOKEN',
          'A block sequence may not be used as an implicit map key'
        );
      }
      key = null;
      pending = info;
    }
  }

  // -------------------------------------------------------------------------
  // Flow collections
  // -------------------------------------------------------------------------

  skipFlowSpace(isMap, close) {
    const kind = isMap ? 'map' : 'sequence';
    const info = this.skipToContent();
    if (!info.found) {
      if (this.flowIndent >= 0) {
        this.error(
          'BAD_INDENT',
          `Flow ${kind} in block collection must be sufficiently indented and end with a ${close}`
        );
      }
      this.error('MISSING_CHAR', `Flow ${kind} must end with a ${close}`);
    }
    if (info.newLine && this.flowIndent >= 0 && info.col <= this.flowIndent) {
      this.error(
        'BAD_INDENT',
        `Flow ${kind} in block collection must be sufficiently indented and end with a ${close}`,
        this.lineStart()
      );
    }
  }

  isFlowValueIndicator(key) {
    if (this.peek() !== ':') {
      return false;
    }
    const next = this.peek(1);
    if (isWsOrEnd(next) || next === '\r' || isFlowChar(next)) {
      return true;
    }
    const jsonLike =
      isCollection(key) ||
      (isScalar(key) &&
        (key.type === 'QUOTE_DOUBLE' || key.type === 'QUOTE_SINGLE'));
    return jsonLike;
  }

  isFlowEnd(c) {
    return c === ',' || c === ']' || c === '}';
  }

  parseFlowNode() {
    if (this.isFlowEnd(this.peek()) || this.isIndicator(':')) {
      return this.emptyScalar(this.pos);
    }
    return this.parseInlineWithProps(this.flowIndent);
  }

  parseFlowEntry(isMap, close) {
    let explicit = false;
    if (
      this.peek() === '?' &&
      (isWsOrEnd(this.peek(1)) || isFlowChar(this.peek(1)))
    ) {
      explicit = true;
      this.pos++;
      this.skipFlowSpace(isMap, close);
    }
    const key = this.parseFlowNode();
    const save = this.pos;
    this.skipFlowSpace(isMap, close);
    let pair = null;
    if (this.isFlowValueIndicator(key)) {
      this.pos++;
      this.skipFlowSpace(isMap, close);
      pair = new Pair(key, this.parseFlowNode());
    } else {
      this.pos = save;
      if (isMap || explicit) {
        pair = new Pair(key, null);
      }
    }
    if (!pair || isMap) {
      return pair ?? key;
    }
    const single = new YAMLMap(this.doc.schema);
    single.flow = true;
    single.items.push(pair);
    single.range = [key.range?.[0] ?? save, this.pos, this.pos];
    return single;
  }

  parseFlow(parentIndent) {
    const start = this.pos;
    const isMap = this.src[start] === '{';
    const close = isMap ? '}' : ']';
    const node = isMap
      ? new YAMLMap(this.doc.schema)
      : new YAMLSeq(this.doc.schema);
    node.flow = true;
    const prevIndent = this.flowIndent;
    if (this.flowDepth === 0) {
      this.flowIndent = parentIndent;
    }
    this.flowDepth++;
    this.pos++;
    for (;;) {
      this.skipFlowSpace(isMap, close);
      const c = this.peek();
      if (c === close) {
        this.pos++;
        break;
      }
      if (this.isFlowEnd(c)) {
        this.error('UNEXPECTED_TOKEN', `Unexpected ${c} in flow collection`);
      }
      const item = this.parseFlowEntry(isMap, close);
      if (isMap) {
        this.addPair(node, item);
      } else {
        node.items.push(item);
      }
      this.skipFlowSpace(isMap, close);
      if (this.peek() === ',') {
        this.pos++;
      } else if (this.peek() !== close) {
        this.error('MISSING_CHAR', 'Missing , between flow collection items');
      }
    }
    this.flowDepth--;
    this.flowIndent = prevIndent;
    node.range = [start, this.pos, this.pos];
    return node;
  }

  // -------------------------------------------------------------------------
  // Document body
  // -------------------------------------------------------------------------

  /** Parse the whole document body, setting doc.contents and comments. */
  parseBody(docStart) {
    const { doc } = this;
    const info = this.skipToContent();
    if (!info.found) {
      doc.contents = docStart ? this.emptyScalar(this.pos) : null;
      if (info.comments.length) {
        doc.comment = joinComments(info.comments);
      }
      return;
    }
    const node = this.parseBlockNode(-1, true);
    if (info.blankAfterComment && !docStart) {
      doc.commentBefore = joinComments(info.comments);
    } else {
      attachCommentBefore(node, joinComments(info.comments));
    }
    doc.contents = node;
    this.endOfNodeLine(node);
    const tail = this.skipToContent();
    if (tail.found) {
      this.error('UNEXPECTED_TOKEN', 'Unexpected scalar at node end');
    }
    if (tail.comments.length) {
      doc.comment = joinComments(tail.comments);
    }
  }
}
