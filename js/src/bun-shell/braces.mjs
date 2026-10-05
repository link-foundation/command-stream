// Brace expansion, ported from Bun's shell brace expander
// (src/shell_parser/braces.rs). Token shapes, the literal-group rules of
// bash 5.2 and the output ordering follow Bun exactly.

export const MAX_BRACE_GROUPS = 256;
export const MAX_BRACE_EXPANSIONS = 65536;

const BRACE_ERROR_MESSAGES = {
  TooManyBraces: 'Too many braces in brace expansion',
  UnexpectedToken: 'Unexpected token in brace expansion',
};

export class BraceError extends Error {
  constructor(kind, message) {
    super(message ?? BRACE_ERROR_MESSAGES[kind] ?? kind);
    this.name = 'BraceError';
    this.kind = kind;
  }
}

// Mirrors ShellCharIter: `\X` yields X marked as escaped, a trailing `\`
// terminates the input.
function* inputChars(src) {
  const chars = Array.from(src);
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '\\') {
      yield { char: chars[i], escaped: false };
      i += 1;
      continue;
    }
    if (i + 1 >= chars.length) {
      return;
    }
    yield { char: chars[i + 1], escaped: true };
    i += 2;
  }
}

function tokenToText(tok) {
  switch (tok.t) {
    case 'Open':
      return '{';
    case 'Comma':
      return ',';
    case 'Close':
      return '}';
    case 'Text':
      return tok.text;
    default:
      return '';
  }
}

function replaceTokenWithString(tokens, idx) {
  tokens[idx] = { t: 'Text', text: tokenToText(tokens[idx]) };
}

function appendChar(tokens, char) {
  const last = tokens[tokens.length - 1];
  if (last && last.t === 'Text') {
    last.text += char;
    return;
  }
  tokens.push({ t: 'Text', text: char });
}

// Unclosed groups are rolled back innermost first. Everything from the
// previous rollback's start onwards is already a fixed point of this scan
// (only balanced groups sit between two unclosed opens), so `limit` bounds
// the scan and keeps the whole pass linear while producing Bun's tokens.
function rollbackBraces(tokens, startingIdx, limit) {
  let braces = 0;
  replaceTokenWithString(tokens, startingIdx);
  for (let i = startingIdx + 1; i < limit; i++) {
    const tag = tokens[i].t;
    if (braces > 0) {
      if (tag === 'Open') {
        braces += 1;
      } else if (tag === 'Close') {
        braces -= 1;
      }
      continue;
    }
    if (tag === 'Open') {
      braces += 1;
      continue;
    }
    if (tag === 'Close' || tag === 'Comma' || tag === 'Text') {
      replaceTokenWithString(tokens, i);
    }
  }
}

function flattenTokens(tokens) {
  let braceCount = 0;
  let containsNested = false;
  const out = [];
  for (const tok of tokens) {
    if (tok.t === 'Open') {
      braceCount += 1;
      if (braceCount > 1) {
        containsNested = true;
      }
    } else if (tok.t === 'Close') {
      braceCount -= 1;
    }
    const prev = out[out.length - 1];
    if (prev && prev.t === 'Text' && tok.t === 'Text') {
      prev.text += tok.text;
    } else {
      out.push(tok);
    }
  }
  return { tokens: out, containsNested };
}

/**
 * Tokenize a brace pattern. Returns `{ tokens, containsNested }`, where tokens
 * are `{t:'Open', idx, end}`, `{t:'Comma'}`, `{t:'Text', text}`,
 * `{t:'Close'}` and a trailing `{t:'Eof'}`.
 */
export function tokenize(src) {
  const tokens = [];
  const braceStack = [];
  for (const { char, escaped } of inputChars(src)) {
    if (!escaped) {
      if (char === '{') {
        braceStack.push({ tokIdx: tokens.length, hasComma: false });
        tokens.push({ t: 'Open', idx: 0, end: 0 });
        continue;
      }
      if (char === '}' && braceStack.length > 0) {
        const top = braceStack.pop();
        if (top.hasComma) {
          tokens.push({ t: 'Close' });
        } else {
          replaceTokenWithString(tokens, top.tokIdx);
          tokens.push({ t: 'Text', text: '}' });
        }
        continue;
      }
      if (char === ',' && braceStack.length > 0) {
        braceStack[braceStack.length - 1].hasComma = true;
        tokens.push({ t: 'Comma' });
        continue;
      }
    }
    appendChar(tokens, char);
  }
  let limit = tokens.length;
  while (braceStack.length > 0) {
    const { tokIdx } = braceStack.pop();
    rollbackBraces(tokens, tokIdx, limit);
    limit = tokIdx;
  }
  const flat = flattenTokens(tokens);
  flat.tokens.push({ t: 'Eof' });
  return flat;
}

const U32_MAX = 0xffffffff;
const satAdd = (a, b) => Math.min(a + b, U32_MAX);
const satMul = (a, b) => Math.min(a * b, U32_MAX);

/** Number of words the tokens expand to (0 when there is nothing to expand). */
export function calculateExpandedAmount(tokens) {
  const stack = [];
  let variantCount = 0;
  for (const tok of tokens) {
    if (tok.t === 'Open') {
      stack.push({ segmentProduct: 1, accumulator: 0 });
    } else if (tok.t === 'Comma') {
      const top = stack[stack.length - 1];
      top.accumulator = satAdd(top.accumulator, top.segmentProduct);
      top.segmentProduct = 1;
    } else if (tok.t === 'Close') {
      const entry = stack.pop();
      const total = satAdd(entry.accumulator, entry.segmentProduct);
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        parent.segmentProduct = satMul(parent.segmentProduct, total);
      } else if (variantCount === 0) {
        variantCount = total;
      } else {
        variantCount = satMul(variantCount, total);
      }
    }
  }
  return variantCount;
}

function checkBraceGroupCount(tokens) {
  const opens = tokens.filter((t) => t.t === 'Open').length;
  if (opens > MAX_BRACE_GROUPS) {
    throw new BraceError('TooManyBraces');
  }
}

function buildExpansionTable(tokens) {
  const table = [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === 'Open') {
      tok.idx = table.length;
      stack.push({ tokIdx: i, prevTokEnd: i });
    } else if (tok.t === 'Close') {
      const top = stack.pop();
      table.push({ start: top.prevTokEnd + 1, end: i });
      tokens[top.tokIdx].end = table.length;
    } else if (tok.t === 'Comma') {
      const top = stack[stack.length - 1];
      table.push({ start: top.prevTokEnd + 1, end: i });
      top.prevTokEnd = i;
    }
  }
  return table;
}

function newOutKey(ctx, outKey, length) {
  const key = ctx.counter;
  ctx.out[key] += ctx.out[outKey].slice(0, length);
  ctx.counter += 1;
  return key;
}

function expandFlat(ctx, outKey, start, end) {
  const { tokens, table, out } = ctx;
  if (start >= tokens.length || end > tokens.length) {
    return;
  }
  for (let i = start; i < end; i++) {
    const tok = tokens[i];
    if (tok.t === 'Text') {
      out[outKey] += tok.text;
    } else if (tok.t === 'Open') {
      const variants = table.slice(tok.idx, tok.end);
      const skipOverIdx = variants[variants.length - 1].end;
      const startingLen = out[outKey].length;
      variants.forEach((variant, vi) => {
        const key = vi === 0 ? outKey : newOutKey(ctx, outKey, startingLen);
        expandFlat(ctx, key, variant.start, variant.end);
        expandFlat(ctx, key, skipOverIdx, end);
      });
      return;
    }
  }
}

// --- Nested expansion: parse into groups, then walk with bubble-up links. ---

class BraceParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
  }

  parse() {
    checkBraceGroupCount(this.tokens);
    const nodes = [];
    while (!this.match('Eof')) {
      const atom = this.parseAtom();
      if (!atom) {
        break;
      }
      nodes.push(atom);
    }
    return makeGroup(nodes);
  }

  parseAtom() {
    const tok = this.advance();
    switch (tok.t) {
      case 'Open':
        return { t: 'Expansion', variants: this.parseExpansion() };
      case 'Text':
        return { t: 'Text', text: tok.text };
      case 'Eof':
        return null;
      default:
        throw new BraceError('UnexpectedToken');
    }
  }

  parseExpansion() {
    const variants = [];
    for (;;) {
      const group = [];
      let close;
      for (;;) {
        if (this.matchAny(['Close', 'Eof'])) {
          close = true;
          break;
        }
        if (this.match('Comma')) {
          close = false;
          break;
        }
        const atom = this.parseAtom();
        if (!atom) {
          close = true;
          break;
        }
        group.push(atom);
      }
      variants.push(makeGroup(group));
      if (close) {
        return variants;
      }
    }
  }

  advance() {
    if (!this.isAtEnd()) {
      this.current += 1;
    }
    return this.current > 0 ? this.tokens[this.current - 1] : this.peek();
  }

  isAtEnd() {
    return this.peek().t === 'Eof';
  }

  match(tag) {
    return this.matchAny([tag]);
  }

  matchAny(tags) {
    if (tags.includes(this.peek().t)) {
      this.advance();
      return true;
    }
    return false;
  }

  peek() {
    return this.tokens[this.current];
  }
}

function makeGroup(atoms) {
  return atoms.length === 1
    ? { bubbleUp: null, bubbleUpNext: null, single: atoms[0] }
    : { bubbleUp: null, bubbleUpNext: null, many: atoms };
}

export function parseBraces(tokens) {
  return new BraceParser(tokens).parse();
}

function bubble(ctx, root, outKey) {
  if (root.bubbleUp) {
    expandNested(ctx, root.bubbleUp, outKey, root.bubbleUpNext);
  }
}

function expandVariants(ctx, root, variants, outKey, next) {
  const length = ctx.out[outKey].length;
  variants.forEach((group, j) => {
    group.bubbleUp = root;
    group.bubbleUpNext = next;
    const key = j === 0 ? outKey : newOutKey(ctx, outKey, length);
    expandNested(ctx, group, key, 0);
  });
}

function expandNested(ctx, root, outKey, start) {
  if (root.single) {
    if (start > 0) {
      bubble(ctx, root, outKey);
      return;
    }
    const atom = root.single;
    if (atom.t === 'Text') {
      ctx.out[outKey] += atom.text;
      bubble(ctx, root, outKey);
      return;
    }
    expandVariants(ctx, root, atom.variants, outKey, 1);
    return;
  }
  const many = root.many;
  for (let i = start; i < many.length; i++) {
    const atom = many[i];
    if (atom.t === 'Text') {
      ctx.out[outKey] += atom.text;
    } else {
      expandVariants(ctx, root, atom.variants, outKey, i + 1);
      return;
    }
  }
  bubble(ctx, root, outKey);
}

/**
 * Expand tokens produced by {@link tokenize} into exactly `count` words
 * (see {@link calculateExpandedAmount}).
 */
export function expand(tokens, count, containsNested) {
  checkBraceGroupCount(tokens);
  const ctx = { tokens, out: new Array(count).fill(''), counter: 1 };
  if (!containsNested) {
    ctx.table = buildExpansionTable(tokens);
    expandFlat(ctx, 0, 0, tokens.length);
    return ctx.out;
  }
  const root = parseBraces(tokens);
  expandNested(ctx, root, 0, 0);
  return ctx.out;
}

// --- Debug output formats used by `$.braces(str, { tokenize | parse })`. ---

export function tokensToJSON(tokens) {
  return `[${tokens
    .map((t) => {
      switch (t.t) {
        case 'Open':
          return `{"open":{"idx":${t.idx},"end":${t.end}}}`;
        case 'Text':
          return `{"text":${JSON.stringify(t.text)}}`;
        default:
          return JSON.stringify(t.t.toLowerCase());
      }
    })
    .join(',')}]`;
}

function atomToJSON(atom) {
  if (atom.t === 'Text') {
    return `{"text":${JSON.stringify(atom.text)}}`;
  }
  return `{"expansion":{"variants":[${atom.variants.map(groupToJSON).join(',')}]}}`;
}

function groupToJSON(group) {
  const atoms = group.single
    ? `{"single":${atomToJSON(group.single)}}`
    : `{"many":[${group.many.map(atomToJSON).join(',')}]}`;
  return `{"bubble_up":null,"bubble_up_next":null,"atoms":${atoms}}`;
}

/**
 * `$.braces(pattern, options)`: expand a brace pattern into words. With
 * `{ tokenize: true }` or `{ parse: true }` it returns the token or AST dump.
 */
export function braces(pattern, options = {}) {
  const input = String(pattern);
  const { tokens, containsNested } = tokenize(input);
  if (options && options.tokenize) {
    return tokensToJSON(tokens);
  }
  if (options && options.parse) {
    return groupToJSON(parseBraces(tokens));
  }
  const count = calculateExpandedAmount(tokens);
  if (count === 0) {
    return [input];
  }
  if (count > MAX_BRACE_EXPANSIONS) {
    throw new BraceError(
      'TooManyExpansions',
      `Too many brace expansions (${count} > ${MAX_BRACE_EXPANSIONS})`
    );
  }
  return expand(tokens, count, containsNested);
}
