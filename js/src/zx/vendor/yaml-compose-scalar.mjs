// Scalar readers used by the composer: plain, single/double quoted and
// block (literal / folded) scalars. Each function receives the composer
// instance `p` (with `src`, `pos`, `end` and an `error()` helper).

const FLOW_INDICATORS = ',[]{}';

export const isWs = (c) => c === ' ' || c === '\t';
export const isWsOrEnd = (c) =>
  c === undefined || c === '' || c === ' ' || c === '\t' || c === '\n';

const DQ_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xa0',
  L: '\u2028',
  P: '\u2029',
};
const DQ_HEX = { x: 2, u: 4, U: 8 };

function trimTrailing(out, protectedLen) {
  let len = out.length;
  while (len > protectedLen && isWs(out[len - 1])) {
    len--;
  }
  return out.slice(0, len);
}

/** Handle a line break inside a quoted scalar (line folding). */
function foldQuotedBreak(p, quote) {
  const breakPos = p.pos;
  let empties = 0;
  p.pos++;
  for (;;) {
    while (p.pos < p.end && isWs(p.src[p.pos])) {
      p.pos++;
    }
    if (p.pos < p.end && p.src[p.pos] === '\n') {
      empties++;
      p.pos++;
      continue;
    }
    break;
  }
  if (p.pos >= p.end) {
    p.error('MISSING_CHAR', `Missing closing ${quote}quote`, p.end, 1);
  }
  if (p.flowDepth === 0 && p.col(p.pos) <= p.quoteIndent) {
    p.error('MISSING_CHAR', `Missing closing ${quote}quote`, breakPos);
  }
  return empties ? '\n'.repeat(empties) : ' ';
}

function readHexEscape(p, width) {
  const hex = p.src.slice(p.pos + 1, p.pos + 1 + width);
  if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) {
    p.error('BAD_DQ_ESCAPE', `Invalid escape sequence \\${p.src[p.pos - 1]}`);
  }
  p.pos += width + 1;
  return String.fromCodePoint(parseInt(hex, 16));
}

function readEscape(p) {
  p.pos++;
  const c = p.src[p.pos];
  if (c === '\n') {
    p.pos++;
    while (p.pos < p.end && isWs(p.src[p.pos])) {
      p.pos++;
    }
    return '';
  }
  if (DQ_HEX[c]) {
    return readHexEscape(p, DQ_HEX[c]);
  }
  if (c !== undefined && c in DQ_ESCAPES) {
    p.pos++;
    return DQ_ESCAPES[c];
  }
  p.error('BAD_DQ_ESCAPE', `Invalid escape sequence \\${c ?? ''}`, p.pos - 1);
  return '';
}

/** Read a double-quoted scalar starting at `p.pos` (the opening quote). */
export function readDoubleQuoted(p) {
  let out = '';
  let protectedLen = 0;
  p.pos++;
  for (;;) {
    if (p.pos >= p.end) {
      p.error('MISSING_CHAR', 'Missing closing "quote', p.end, 1);
    }
    const c = p.src[p.pos];
    if (c === '"') {
      p.pos++;
      break;
    }
    if (c === '\\') {
      out += readEscape(p);
      protectedLen = out.length;
    } else if (c === '\n') {
      out = trimTrailing(out, protectedLen) + foldQuotedBreak(p, '"');
    } else if (c === '\r' && p.src[p.pos + 1] === '\n') {
      p.pos++;
    } else {
      out += c;
      p.pos++;
    }
  }
  return out;
}

/** Read a single-quoted scalar starting at `p.pos` (the opening quote). */
export function readSingleQuoted(p) {
  let out = '';
  p.pos++;
  for (;;) {
    if (p.pos >= p.end) {
      p.error('MISSING_CHAR', "Missing closing 'quote", p.end, 1);
    }
    const c = p.src[p.pos];
    if (c === "'") {
      if (p.src[p.pos + 1] === "'" && p.pos + 1 < p.end) {
        out += "'";
        p.pos += 2;
        continue;
      }
      p.pos++;
      break;
    }
    if (c === '\n') {
      out = trimTrailing(out, 0) + foldQuotedBreak(p, "'");
    } else {
      out += c;
      p.pos++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plain scalars
// ---------------------------------------------------------------------------

function plainStops(p, i, flow) {
  const c = p.src[i];
  if (c === '\n' || (c === '\r' && p.src[i + 1] === '\n')) {
    return true;
  }
  if (c === ':') {
    const n = i + 1 < p.end ? p.src[i + 1] : undefined;
    return isWsOrEnd(n) || n === '\r' || (flow && FLOW_INDICATORS.includes(n));
  }
  if (c === '#' && i > 0 && isWs(p.src[i - 1])) {
    return true;
  }
  return flow && FLOW_INDICATORS.includes(c);
}

/** Read the part of a plain scalar that is on the current line. */
function readPlainLine(p, flow) {
  let i = p.pos;
  let lastNonWs = i;
  while (i < p.end && !plainStops(p, i, flow)) {
    const c = p.src[i];
    i++;
    if (!isWs(c)) {
      lastNonWs = i;
    }
  }
  const text = p.src.slice(p.pos, lastNonWs);
  p.pos = lastNonWs;
  return text;
}

function skipInlineSpace(src, i, end) {
  let j = i;
  while (j < end && (isWs(src[j]) || src[j] === '\r')) {
    j++;
  }
  return j;
}

function scanContinuation(p, parentIndent, flow) {
  const { src } = p;
  let i = skipInlineSpace(src, p.pos, p.end);
  if (src[i] !== '\n' || i >= p.end) {
    return null;
  }
  let empties = -1;
  let lineStart = i;
  while (i < p.end && src[i] === '\n') {
    empties++;
    lineStart = i + 1;
    i = skipInlineSpace(src, lineStart, p.end);
  }
  const stop =
    i >= p.end ||
    src[i] === '#' ||
    i - lineStart <= parentIndent ||
    (flow && FLOW_INDICATORS.includes(src[i]));
  return stop ? null : { pos: i, empties };
}

/** Read a (possibly multi-line) plain scalar. */
export function readPlain(p, parentIndent, flow) {
  let text = readPlainLine(p, flow);
  let end = p.pos;
  for (;;) {
    const next = scanContinuation(p, parentIndent, flow);
    if (!next) {
      break;
    }
    p.pos = next.pos;
    const line = readPlainLine(p, flow);
    if (line === '') {
      break;
    }
    text += next.empties ? '\n'.repeat(next.empties) : ' ';
    text += line;
    end = p.pos;
  }
  p.pos = end;
  return text;
}

// ---------------------------------------------------------------------------
// Block scalars
// ---------------------------------------------------------------------------

function readBlockIndicators(p, header) {
  for (let k = 0; k < 2; k++) {
    const c = p.src[p.pos];
    if (c >= '1' && c <= '9' && !header.indent) {
      header.indent = Number(c);
    } else if ((c === '-' || c === '+') && header.chomp === 'clip') {
      header.chomp = c === '-' ? 'strip' : 'keep';
    } else {
      return;
    }
    p.pos++;
  }
}

function readBlockHeader(p) {
  const header = { literal: p.src[p.pos] === '|', indent: 0, chomp: 'clip' };
  p.pos++;
  readBlockIndicators(p, header);
  while (p.pos < p.end && isWs(p.src[p.pos])) {
    p.pos++;
  }
  if (p.src[p.pos] === '#') {
    const eol = p.src.indexOf('\n', p.pos);
    header.comment = p.src.slice(p.pos + 1, eol === -1 ? p.end : eol);
    p.pos = eol === -1 ? p.end : Math.min(eol, p.end);
  }
  if (p.pos < p.end && p.src[p.pos] !== '\n' && p.src[p.pos] !== '\r') {
    p.error(
      'UNEXPECTED_TOKEN',
      'Block scalar header includes extra characters'
    );
  }
  return header;
}

function detectIndent(p, from, parentIndent) {
  let i = from;
  let maxEmpty = 0;
  while (i < p.end) {
    let j = i;
    while (j < p.end && p.src[j] === ' ') {
      j++;
    }
    const c = p.src[j];
    if (j < p.end && c !== '\n' && c !== '\r') {
      return j - i > parentIndent
        ? j - i
        : Math.max(maxEmpty, parentIndent + 1);
    }
    maxEmpty = Math.max(maxEmpty, j - i);
    i = p.src.indexOf('\n', j);
    if (i === -1) {
      break;
    }
    i++;
  }
  return Math.max(maxEmpty, parentIndent + 1);
}

function collectBlockLines(p, from, n) {
  const lines = [];
  let i = from;
  let stop = from;
  while (i < p.end) {
    let eol = p.src.indexOf('\n', i);
    if (eol === -1 || eol > p.end) {
      eol = p.end;
    }
    const raw = p.src.slice(i, eol).replace(/\r$/, '');
    let spaces = 0;
    while (spaces < raw.length && raw[spaces] === ' ') {
      spaces++;
    }
    if (spaces === raw.length) {
      lines.push(raw.slice(n));
    } else if (spaces < n) {
      break;
    } else {
      lines.push(raw.slice(n));
    }
    i = eol + 1;
    stop = Math.min(i, p.end);
  }
  return { lines, stop };
}

function foldBlockLines(lines) {
  let out = '';
  let prev = null;
  let empties = 0;
  for (const line of lines) {
    if (line === '') {
      empties++;
      continue;
    }
    if (prev === null) {
      out += '\n'.repeat(empties) + line;
    } else if (isWs(line[0]) || isWs(prev[0])) {
      out += `\n${'\n'.repeat(empties)}${line}`;
    } else {
      out += (empties ? '\n'.repeat(empties) : ' ') + line;
    }
    prev = line;
    empties = 0;
  }
  return out;
}

/** Read a `|` or `>` block scalar; returns its value and header info. */
export function readBlockScalar(p, parentIndent) {
  const header = readBlockHeader(p);
  const from = p.pos < p.end ? p.pos + 1 : p.end;
  const n = header.indent
    ? Math.max(parentIndent, 0) + header.indent
    : detectIndent(p, from, parentIndent);
  const { lines, stop } = collectBlockLines(p, from, Math.max(n, 0));
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === '') {
    last--;
  }
  const content = lines.slice(0, last + 1);
  const trailing = lines.length - content.length;
  let value = header.literal ? content.join('\n') : foldBlockLines(content);
  if (header.chomp === 'keep') {
    value += content.length
      ? `\n${'\n'.repeat(trailing)}`
      : '\n'.repeat(trailing);
  } else if (header.chomp === 'clip' && content.length) {
    value += '\n';
  }
  p.pos = stop;
  if (stop > from && p.src[stop - 1] === '\n') {
    p.pos = stop - 1;
  }
  return { value, header };
}
