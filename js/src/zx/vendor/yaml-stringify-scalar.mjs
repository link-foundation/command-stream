// Scalar stringification: numbers, plain/quoted strings and block scalars,
// including line folding at `lineWidth`.

const ESCAPES = {
  '"': '\\"',
  '\\': '\\\\',
  '\0': '\\0',
  '\x07': '\\a',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\v': '\\v',
  '\f': '\\f',
  '\r': '\\r',
  '\x1b': '\\e',
};

const JSON_ESCAPES = { ...ESCAPES, '\0': '\\u0000', '\x07': '\\u0007' };
delete JSON_ESCAPES['\v'];
delete JSON_ESCAPES['\x1b'];

// Characters that cannot appear unescaped in plain or single-quoted scalars.
const NEEDS_ESCAPE = /[\x00-\x08\x0b-\x1f\x7f]/;
const INDICATOR_START = /^(?:[-?:](?:[ \t]|$)|[,[\]{}#&*!|>'"%@`])/;
const DOC_MARKER_START = /^(?:---|\.\.\.)/;

function hex(code, width) {
  return code.toString(16).toUpperCase().padStart(width, '0');
}

export function escapeDouble(str, asJSON = false) {
  const table = asJSON ? JSON_ESCAPES : ESCAPES;
  let out = '';
  for (const ch of str) {
    if (table[ch]) {
      out += table[ch];
      continue;
    }
    const code = ch.codePointAt(0);
    if (code < 0x20) {
      out += asJSON ? `\\u${hex(code, 4)}` : `\\x${hex(code, 2)}`;
    } else {
      out += ch;
    }
  }
  return out;
}

const RADIX_FORMATS = { HEX: ['0x', 16], OCT: ['0o', 8], BIN: ['0b', 2] };

function padFraction(str, min) {
  if (!min || !/^-?\d+(?:\.\d*)?$/.test(str)) {
    return str;
  }
  const dot = str.indexOf('.');
  const frac = dot === -1 ? 0 : str.length - dot - 1;
  const base = dot === -1 ? `${str}.` : str;
  return base + '0'.repeat(Math.max(0, min - frac));
}

/** Stringify a JS number the way yaml's core schema does. */
export function stringifyNumber(node, value) {
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (Number.isNaN(value)) {
    return '.nan';
  }
  if (!Number.isFinite(value)) {
    return value < 0 ? '-.inf' : '.inf';
  }
  if (Object.is(value, -0)) {
    return '-0';
  }
  const format = node?.format;
  const radix = RADIX_FORMATS[format];
  if (radix && Number.isInteger(value) && value >= 0) {
    return `${radix[0]}${value.toString(radix[1])}`;
  }
  if (format === 'EXP') {
    return value.toExponential();
  }
  return padFraction(JSON.stringify(value), node?.minFractionDigits);
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/**
 * Greedily fold `text` at break candidates so that the first line has at most
 * `first` characters and later lines at most `rest` characters.
 */
export function foldText(text, first, rest, canBreak) {
  const lines = [];
  let start = 0;
  let limit = first;
  let cand = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ' || !canBreak(text, i)) {
      continue;
    }
    if (i - start > limit && cand !== -1) {
      lines.push(text.slice(start, cand));
      start = cand + 1;
      limit = rest;
    }
    cand = i;
  }
  if (text.length - start > limit && cand >= start) {
    lines.push(text.slice(start, cand));
    start = cand + 1;
  }
  lines.push(text.slice(start));
  return lines;
}

const isBlank = (ch) => ch === ' ' || ch === '\t';

function quotedBreak(text, i) {
  const next = text[i + 1];
  return (
    !isBlank(text[i - 1]) &&
    text[i - 1] !== '\\' &&
    next !== undefined &&
    !isBlank(next)
  );
}

const ESCAPE_SKIP = { x: 3, u: 5, U: 9 };
const isSpaceOrBreak = (ch) => ch === ' ' || ch === '\t' || ch === '\n';

function firstLineEnd(ctx, minWidth, folds) {
  const { lineWidth } = ctx.options;
  const atStart = ctx.indentAtStart;
  if (typeof atStart !== 'number') {
    return lineWidth - ctx.indent.length;
  }
  if (atStart > lineWidth - Math.max(2, minWidth)) {
    folds.push(0);
    return lineWidth - ctx.indent.length;
  }
  return lineWidth - atStart;
}

/**
 * In a quoted scalar without a usable space, fold with an escaped line break
 * placed just before position `i` (and outside any escape sequence).
 */
function escapedFold(text, start, prevCh, curCh, esc) {
  let i = start;
  let prev = prevCh;
  let ch = curCh;
  while (prev === ' ' || prev === '\t') {
    prev = ch;
    ch = text[++i];
  }
  const fold = i > esc[1] + 1 ? i - 2 : esc[0] - 1;
  return { fold, i, ch };
}

const isSplitPoint = (ch, prev, next) =>
  ch === ' ' &&
  !!prev &&
  !isSpaceOrBreak(prev) &&
  !!next &&
  !isSpaceOrBreak(next);

/** Find fold positions for a flow (plain or quoted) scalar. */
function findFolds(text, ctx, quoted, state) {
  const { folds, escaped, step } = state;
  let end = firstLineEnd(ctx, state.minWidth, folds);
  let split = -1;
  let prev;
  let esc = [-1, -1];
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (quoted && ch === '\\') {
      esc = [i, i + (ESCAPE_SKIP[text[i + 1]] ?? 1)];
      i = esc[1];
    }
    if (ch === '\n') {
      end = i + ctx.indent.length + step;
      split = -1;
      prev = ch;
      continue;
    }
    if (isSplitPoint(ch, prev, text[i + 1])) {
      split = i;
    }
    if (i >= end && split > 0) {
      folds.push(split);
      end = split + step;
      split = -1;
    } else if (i >= end && quoted) {
      const cut = escapedFold(text, i, prev, ch, esc);
      if (escaped.has(cut.fold)) {
        return false;
      }
      folds.push(cut.fold);
      escaped.add(cut.fold);
      end = cut.fold + step;
      i = cut.i;
      ch = cut.ch;
    }
    prev = ch;
  }
  return true;
}

/**
 * Fold a plain or quoted flow scalar to fit `lineWidth`, using the same
 * line-breaking rules as yaml's flow folding.
 */
export function foldFlow(text, ctx, quoted) {
  const { lineWidth, minContentWidth } = ctx.options;
  if (!lineWidth || lineWidth < 0 || ctx.implicitKey || ctx.inFlow) {
    return text;
  }
  const minWidth = lineWidth < minContentWidth ? 0 : minContentWidth;
  const step = Math.max(1 + minWidth, 1 + lineWidth - ctx.indent.length);
  if (text.length <= step) {
    return text;
  }
  const state = { folds: [], escaped: new Set(), step, minWidth };
  if (!findFolds(text, ctx, quoted, state) || state.folds.length === 0) {
    return text;
  }
  const { folds, escaped } = state;
  let res = text.slice(0, folds[0]);
  folds.forEach((fold, n) => {
    const stop = folds[n + 1] || text.length;
    if (fold === 0) {
      res = `\n${ctx.indent}${text.slice(0, stop)}`;
      return;
    }
    if (quoted && escaped.has(fold)) {
      res += `${text[fold]}\\`;
    }
    res += `\n${ctx.indent}${text.slice(fold + 1, stop)}`;
  });
  return res;
}

// ---------------------------------------------------------------------------
// Quoted & plain strings
// ---------------------------------------------------------------------------

function doubleQuoted(str, ctx) {
  const json = ctx.options.doubleQuotedAsJSON;
  const body = escapeDouble(str, json);
  if (json) {
    return `"${body}"`;
  }
  return foldFlow(`"${body}"`, ctx, true);
}

function singleQuoted(str) {
  return `'${str.replace(/'/g, "''")}'`;
}

function quotedString(str, ctx) {
  const { singleQuote } = ctx.options;
  const hasDouble = str.includes('"');
  const hasSingle = str.includes("'");
  const canSingle = !NEEDS_ESCAPE.test(str) && !/[\n\r]/.test(str);
  if (singleQuote === false || !canSingle) {
    return doubleQuoted(str, ctx);
  }
  if (singleQuote === true) {
    return hasSingle && !hasDouble ? doubleQuoted(str, ctx) : singleQuoted(str);
  }
  return hasDouble && !hasSingle ? singleQuoted(str) : doubleQuoted(str, ctx);
}

/** Whether `str` can be written as a plain scalar in this context. */
function plainCharsAllowed(str) {
  if (str === '' || isBlank(str[0]) || isBlank(str[str.length - 1])) {
    return false;
  }
  if (/[\n\r]/.test(str) || NEEDS_ESCAPE.test(str)) {
    return false;
  }
  return !INDICATOR_START.test(str) && !/:$|:[ \t]|[ \t]#/.test(str);
}

export function plainAllowed(str, ctx) {
  if (!plainCharsAllowed(str)) {
    return false;
  }
  if (ctx.inFlow && /[,[\]{}]/.test(str)) {
    return false;
  }
  if (ctx.implicitKey && str.length > 1024) {
    return false;
  }
  if (DOC_MARKER_START.test(str) && ctx.indent === '') {
    return false;
  }
  const schema = ctx.doc?.schema;
  const resolved = schema ? schema.resolvePlain(str) : null;
  return resolved === null;
}

// ---------------------------------------------------------------------------
// Block scalars
// ---------------------------------------------------------------------------

function lineOverLimit(str, limit) {
  return str.split('\n').some((line) => line.length > limit);
}

const moreIndented = (line) => line !== '' && isBlank(line[0]);

/** Encode `body` so that parsing it as a folded scalar reproduces it. */
function foldedLines(body, limit, minContentWidth) {
  const src = body.split('\n');
  const out = [];
  const width = Math.max(limit, minContentWidth);
  let prev = null;
  let empties = 0;
  for (const line of src) {
    if (line === '') {
      empties++;
      continue;
    }
    if (prev === null) {
      out.push(...Array(empties).fill(''));
    } else {
      const keep = moreIndented(prev) || moreIndented(line);
      out.push(...Array(keep ? empties : empties + 1).fill(''));
    }
    if (moreIndented(line)) {
      out.push(line);
    } else {
      out.push(...foldText(line, width, width, quotedBreak));
    }
    prev = line;
    empties = 0;
  }
  return out;
}

function blockIndent(ctx) {
  if (ctx.forceBlockIndent) {
    return ctx.forceBlockIndent;
  }
  return ctx.indent;
}

/** Stringify a string as a `|` or `>` block scalar. */
export function blockString(str, ctx, literalHint) {
  const { blockQuote, lineWidth, minContentWidth } = ctx.options;
  const indent = blockIndent(ctx);
  const trailing = str.match(/\n*$/)[0].length;
  const body = str.slice(0, str.length - trailing);
  let chomp = '+';
  if (trailing === 0) {
    chomp = '-';
  } else if (trailing === 1 && body !== '') {
    chomp = '';
  }
  let literal = literalHint;
  if (literal === undefined) {
    literal =
      blockQuote === 'literal' ||
      (blockQuote !== 'folded' &&
        !(lineWidth > 0 && lineOverLimit(body, lineWidth - indent.length)));
  }
  const firstContent = body.split('\n').find((l) => l !== '') ?? '';
  const parentCol = ctx.parentCol ?? -1;
  const indicator =
    firstContent[0] === ' ' ? String(indent.length - parentCol) : '';
  const header = `${literal ? '|' : '>'}${indicator}${chomp}`;
  const lines = literal
    ? body.split('\n')
    : foldedLines(body, lineWidth - indent.length, minContentWidth);
  let text = lines
    .map((line, i) => (line === '' && i > 0 ? '' : indent + line))
    .join('\n');
  if (chomp === '+') {
    text += '\n'.repeat(trailing - 1);
  }
  return `${header}\n${text}`;
}

function wantsBlock(ctx) {
  return !ctx.implicitKey && !ctx.inFlow && ctx.options.blockQuote !== false;
}

function stringByType(str, ctx, type) {
  switch (type) {
    case 'QUOTE_DOUBLE':
      return doubleQuoted(str, ctx);
    case 'QUOTE_SINGLE':
      return NEEDS_ESCAPE.test(str) || /[\n\r]/.test(str)
        ? doubleQuoted(str, ctx)
        : singleQuoted(str);
    case 'BLOCK_LITERAL':
    case 'BLOCK_FOLDED':
      if (wantsBlock(ctx)) {
        return blockString(str, ctx, type === 'BLOCK_LITERAL');
      }
      return doubleQuoted(str, ctx);
    default:
      return null;
  }
}

/** Stringify a string scalar, choosing a style like yaml does. */
function wantedStringType(ctx, node) {
  const { defaultStringType, defaultKeyType } = ctx.options;
  let type = node?.type;
  if (ctx.implicitKey && defaultKeyType && !type) {
    type = defaultKeyType;
  }
  if (!type && defaultStringType && defaultStringType !== 'PLAIN') {
    type = defaultStringType;
  }
  return type;
}

function multiLineString(str, ctx) {
  if (wantsBlock(ctx) && !/\r/.test(str)) {
    const blockCtx = ctx.topLevel ? { ...ctx, forceBlockIndent: '  ' } : ctx;
    const needIndent = ctx.topLevel && /^(?:---|\.\.\.)/m.test(str);
    return blockString(str, needIndent ? blockCtx : ctx);
  }
  return doubleQuoted(str, ctx);
}

export function stringifyString(str, ctx, node) {
  const type = wantedStringType(ctx, node);
  const typed = type && type !== 'PLAIN' ? stringByType(str, ctx, type) : null;
  if (typed !== null) {
    return typed;
  }
  if (/\n/.test(str) || (DOC_MARKER_START.test(str) && ctx.topLevel)) {
    return multiLineString(str, ctx);
  }
  if (plainAllowed(str, ctx)) {
    return foldFlow(str, ctx, false);
  }
  return quotedString(str, ctx);
}
