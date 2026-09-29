// Error classes and line/column helpers for the dependency-free YAML
// implementation used by the zx compatibility layer.

export class YAMLError extends Error {
  constructor(name, pos, code, message) {
    super();
    this.name = name;
    this.code = code;
    this.message = message;
    this.pos = pos;
  }
}

export class YAMLParseError extends YAMLError {
  constructor(pos, code, message) {
    super('YAMLParseError', pos, code, message);
  }
}

export class YAMLWarning extends YAMLError {
  constructor(pos, code, message) {
    super('YAMLWarning', pos, code, message);
  }
}

/**
 * Tracks newline offsets so that source offsets can be mapped to 1-based
 * line/column positions.
 */
export class LineCounter {
  constructor() {
    this.lineStarts = [];
    this.addNewLine = (offset) => this.lineStarts.push(offset);
    this.linePos = (offset) => {
      let low = 0;
      let high = this.lineStarts.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (this.lineStarts[mid] < offset) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      if (this.lineStarts[low] === offset) {
        return { line: low + 1, col: 1 };
      }
      if (low === 0) {
        return { line: 0, col: offset };
      }
      const start = this.lineStarts[low - 1];
      return { line: low, col: offset - start + 1 };
    };
  }
}

/** Build a LineCounter for a complete source string. */
export function lineCounterFor(src) {
  const lc = new LineCounter();
  lc.addNewLine(0);
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') {
      lc.addNewLine(i + 1);
    }
  }
  return lc;
}

function contextLines(src, lc, start) {
  const { line, col } = start;
  const lineText = (n) => {
    const from = lc.lineStarts[n - 1];
    if (from === undefined) {
      return '';
    }
    const to = lc.lineStarts[n] ?? src.length + 1;
    return src.slice(from, to).replace(/\n$/, '');
  };
  let text = lineText(line);
  let caretCol = col;
  if (text.length > 80) {
    const from = Math.max(0, Math.min(col - 40, text.length - 79));
    text = `…${text.slice(from + 1, from + 80)}…`;
    caretCol = col - from;
  }
  const prev = line > 1 && caretCol < 60 ? lineText(line - 1) : '';
  const prefix = prev && prev.length <= 80 ? `${prev}\n` : '';
  return { text: `${prefix}${text}`, caretCol };
}

/** Add `linePos` and a source excerpt to an error, like yaml's prettyErrors. */
export function prettifyError(src, lc) {
  return (error) => {
    if (!error.pos || error.linePos) {
      return;
    }
    const start = lc.linePos(error.pos[0]);
    const end = lc.linePos(Math.max(error.pos[1], error.pos[0] + 1));
    error.linePos = [start, end];
    error.message += ` at line ${start.line}, column ${start.col}`;
    const { text, caretCol } = contextLines(src, lc, start);
    if (text && /[^\s]/.test(text)) {
      let count = 1;
      if (end.line === start.line) {
        count = Math.max(1, Math.min(end.col - start.col, 80 - caretCol));
      }
      const caret = `${' '.repeat(Math.max(0, caretCol - 1))}${'^'.repeat(count)}`;
      error.message += `:\n\n${text}\n${caret}\n`;
    }
  };
}

/** Emit a warning the same way yaml does (process warnings when possible). */
export function emitWarning(warning, logLevel = 'warn') {
  if (logLevel !== 'warn' && logLevel !== 'debug') {
    return;
  }
  if (typeof process !== 'undefined' && process.emitWarning) {
    process.emitWarning(warning);
  } else {
    console.warn(warning);
  }
}
