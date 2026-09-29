// Tagged-template → shell source, ported from Bun's `shell_cmd_from_js` /
// `handle_template_value` / `ShellSrcBuilder` (src/runtime/shell/shell_body.rs)
// and `escape_*` (src/shell_parser/parse.rs).
//
// Interpolated strings that need quoting are not spliced into the source; they
// are replaced by `\x08__bunstr_N\x08` references resolved by the lexer, and
// objects (buffers, streams, blobs, responses) by `\x08__bun_N\x08`.

import { filePathOf } from './file.mjs';
import {
  LEX_JS_OBJREF_PREFIX,
  LEX_JS_STRING_PREFIX,
  SPECIAL_CHARS,
  SPECIAL_JS_CHAR,
} from './lexer.mjs';

const MAX_TEMPLATE_ARRAY_DEPTH = 100;
const IF_CLAUSE_KEYWORDS = new Set(['if', 'else', 'elif', 'then', 'fi']);
const BACKSLASHABLE_CHARS = new Set(['$', '`', '"', '\\']);

/** Error carrying Node-style `code`, as Bun's `ERR_INVALID_ARG_VALUE`. */
function nullByteError(str) {
  const err = new TypeError(
    `The shell argument must be a string without null bytes. Received "${str}"`
  );
  err.code = 'ERR_INVALID_ARG_VALUE';
  return err;
}

function isWellFormed(str) {
  if (typeof str.isWellFormed === 'function') {
    return str.isWellFormed();
  }
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    str
  );
}

/** JSC's `JSValue::toString` (ToString with JSC's symbol message). */
export function jsToString(value) {
  if (typeof value === 'symbol') {
    throw new TypeError('Cannot convert a symbol to a string');
  }
  try {
    return `${value}`;
  } catch (e) {
    if (e instanceof TypeError && /symbol/i.test(e.message)) {
      throw new TypeError('Cannot convert a symbol to a string');
    }
    throw e;
  }
}

/** Whether an interpolated string must be passed by reference (quoted). */
export function needsEscape(str) {
  if (str.length === 0) {
    return true;
  }
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0xff && SPECIAL_CHARS.has(str[i])) {
      return true;
    }
  }
  return false;
}

/** Bun's `escape_*::<ADD_QUOTES>`: backslash `$ \` " \\` and neutralise `\x08`. */
export function escapeShellString(str, addQuotes = true) {
  let out = addQuotes ? '"' : '';
  for (const ch of str) {
    if (BACKSLASHABLE_CHARS.has(ch)) {
      out += `\\${ch}`;
    } else if (ch === SPECIAL_JS_CHAR) {
      out += `${SPECIAL_JS_CHAR}""`;
    } else {
      out += ch;
    }
  }
  return addQuotes ? `${out}"` : out;
}

/** `$.escape(value)`: quote a string for safe use inside a shell script. */
export function shellEscape(...args) {
  if (args.length < 1) {
    throw new Error('shell escape expected at least 1 argument');
  }
  const str = jsToString(args[0]);
  return needsEscape(str) ? escapeShellString(str, true) : str;
}

function isBufferLike(value) {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' &&
      value instanceof SharedArrayBuffer)
  );
}

function isInstance(value, name) {
  const ctor = globalThis[name];
  return typeof ctor === 'function' && value instanceof ctor;
}

function implementsToString(value) {
  const fn = value.toString;
  return typeof fn === 'function' && fn !== Object.prototype.toString;
}

function formatForError(value) {
  try {
    return jsToString(value);
  } catch {
    return null;
  }
}

class ShellSourceBuilder {
  constructor() {
    this.script = '';
    this.jsobjs = [];
    this.jsstrings = [];
  }

  endsWithVarRef() {
    for (let i = this.script.length - 1; i >= 0; i--) {
      if (!/[A-Za-z0-9_]/.test(this.script[i])) {
        return this.script[i] === '$';
      }
    }
    return false;
  }

  appendJsValueStr(value, allowEscape) {
    const str = jsToString(value);
    if (str.includes('\0')) {
      throw nullByteError(str);
    }
    this.appendStr(str, allowEscape);
  }

  appendStr(str, allowEscape) {
    if (!isWellFormed(str)) {
      throw new Error('Shell script string contains invalid UTF-16');
    }
    if (
      allowEscape &&
      (needsEscape(str) || IF_CLAUSE_KEYWORDS.has(str) || this.endsWithVarRef())
    ) {
      this.script += `${LEX_JS_STRING_PREFIX}${this.jsstrings.length}${SPECIAL_JS_CHAR}`;
      this.jsstrings.push(str);
      return;
    }
    this.script += str;
  }

  appendObjRef(value) {
    this.script += `${LEX_JS_OBJREF_PREFIX}${this.jsobjs.length}${SPECIAL_JS_CHAR}`;
    this.jsobjs.push(value);
  }

  appendValue(value, depth, options) {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function')
    ) {
      this.appendJsValueStr(value, true);
      return;
    }
    if (isBufferLike(value)) {
      this.appendObjRef(value);
      return;
    }
    const path = filePathOf(value);
    if (path !== null) {
      if (path.includes('\0')) {
        throw nullByteError(path);
      }
      this.appendStr(path, true);
      return;
    }
    if (isInstance(value, 'Blob')) {
      this.appendObjRef(value);
      return;
    }
    if (
      isInstance(value, 'ReadableStream') ||
      isInstance(value, 'Response') ||
      (options.acceptObject && options.acceptObject(value))
    ) {
      this.appendObjRef(value);
      return;
    }
    if (Array.isArray(value)) {
      this.appendArray(value, depth, options);
      return;
    }
    if (Object.hasOwn(value, 'raw') && value.raw !== undefined) {
      const str = jsToString(value.raw);
      if (str.includes('\0')) {
        throw nullByteError(str);
      }
      this.appendStr(str, false);
      return;
    }
    if (implementsToString(value)) {
      this.appendJsValueStr(value, true);
      return;
    }
    const formatted = formatForError(value);
    throw new Error(
      formatted === null
        ? 'Invalid JS object used in shell: '
        : `Invalid JS object used in shell: ${formatted}, you might need to call \`.toString()\` on it`
    );
  }

  appendArray(array, depth, options) {
    if (depth >= MAX_TEMPLATE_ARRAY_DEPTH) {
      throw new Error(
        `Shell script template arrays cannot be nested more than ${MAX_TEMPLATE_ARRAY_DEPTH} levels deep`
      );
    }
    for (let i = 0; i < array.length; i++) {
      this.appendValue(array[i], depth + 1, options);
      if (i < array.length - 1) {
        this.script += ' ';
      }
    }
  }
}

/**
 * Build shell source from tagged-template parts.
 *
 * @param {readonly string[]} rawStrings `strings.raw` of the template
 * @param {unknown[]} values interpolated values
 * @param {{acceptObject?: (value: object) => boolean}} [options] extra object
 *   kinds to pass by reference (e.g. Node.js streams)
 * @returns {{script: string, jsobjs: unknown[], jsstrings: string[]}}
 */
export function buildShellSource(rawStrings, values, options = {}) {
  const builder = new ShellSourceBuilder();
  const last = Math.max(rawStrings.length - 1, 0);
  for (let i = 0; i < rawStrings.length; i++) {
    builder.appendJsValueStr(rawStrings[i], false);
    if (i < last) {
      if (i >= values.length) {
        throw new Error('Shell script is missing JSValue arg');
      }
      builder.appendValue(values[i], 0, options);
    }
  }
  return {
    script: builder.script,
    jsobjs: builder.jsobjs,
    jsstrings: builder.jsstrings,
  };
}
