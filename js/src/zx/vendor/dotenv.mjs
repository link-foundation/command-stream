// Dependency-free .env parser/serializer compatible with the `envapi` API that
// zx re-exports as `dotenv`. Written from the documented behavior.

import fs from 'node:fs';
import path from 'node:path';

const QUOTES = ['"', "'", '`'];
const TRIPLE_QUOTES = ['"""', "'''", '```'];
const LINE_BREAK_RE = /\r?\n/;
const NEEDS_QUOTES_RE = /[\s#'"`]/;

// Finds the first unescaped `quote` in `text` starting at `from`.
function findClosingQuote(text, quote, from = 0) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\' && quote !== "'") {
      i++;
    } else if (text[i] === quote) {
      return i;
    }
  }
  return -1;
}

function stripInlineComment(value) {
  const match = /(^|\s)#/.exec(value);
  return (match ? value.slice(0, match.index) : value).trim();
}

// Reads a value that may span several lines; `closer` locates the closing
// delimiter in a line and returns its index or -1.
function readQuoted(lines, start, first, closer) {
  const sameLine = closer(first, true);
  if (sameLine !== -1) {
    return { value: first.slice(0, sameLine), next: start + 1 };
  }
  const parts = first === '' ? [] : [first];
  for (let i = start + 1; i < lines.length; i++) {
    const end = closer(lines[i], false);
    if (end !== -1) {
      const tail = lines[i].slice(0, end);
      if (tail.trim() !== '' || parts.length === 0) {
        parts.push(tail);
      }
      return { value: parts.join('\n'), next: i + 1 };
    }
    parts.push(lines[i]);
  }
  // Unterminated quote: keep the opening line only, like single-line parsers.
  return { value: first, next: start + 1 };
}

function readValue(lines, index, raw) {
  const triple = TRIPLE_QUOTES.find((q) => raw.startsWith(q));
  if (triple) {
    return readQuoted(lines, index, raw.slice(3), (line) =>
      line.indexOf(triple)
    );
  }
  const quote = QUOTES.find((q) => raw.startsWith(q));
  if (quote) {
    return readQuoted(lines, index, raw.slice(1), (line) =>
      findClosingQuote(line, quote)
    );
  }
  return { value: stripInlineComment(raw), next: index + 1 };
}

/**
 * Parse dotenv-formatted text into a plain object.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parse(content) {
  const result = {};
  const lines = String(content ?? '').split(LINE_BREAK_RE);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim().replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (line.startsWith('#') || !key || /\s/.test(key)) {
      index++;
      continue;
    }
    const { value, next } = readValue(lines, index, line.slice(eq + 1).trim());
    result[key] = value;
    index = next;
  }
  return result;
}

function quoteValue(value) {
  if (!NEEDS_QUOTES_RE.test(value)) {
    return value;
  }
  if (!/[\r\n]/.test(value)) {
    // Single quotes keep backslashes verbatim, so prefer them.
    if (!value.includes("'")) {
      return `'${value}'`;
    }
    const quote = value.includes('\\')
      ? undefined
      : QUOTES.find((q) => !value.includes(q));
    if (quote) {
      return `${quote}${value}${quote}`;
    }
  }
  const triple = TRIPLE_QUOTES.find((q) => !value.includes(q)) || '"""';
  return `${triple}\n${value}\n${triple}`;
}

/**
 * Serialize an object into dotenv-formatted text.
 * @param {Record<string, unknown>} env
 * @returns {string}
 */
export function stringify(env) {
  return Object.entries(env || {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${quoteValue(String(value ?? ''))}`)
    .join('\n');
}

function readEnvFile(file) {
  return parse(fs.readFileSync(path.resolve(String(file)), 'utf8'));
}

function mergeFirstWins(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = value;
    }
  }
  return target;
}

/**
 * Read and merge env files; values from earlier files take precedence.
 * Throws the native fs error when a file cannot be read.
 * @param {...string} files
 * @returns {Record<string, string>}
 */
export function load(...files) {
  return files.reduce(
    (env, file) => mergeFirstWins(env, readEnvFile(file)),
    {}
  );
}

/**
 * Like `load`, but silently skips files that cannot be read.
 * @param {...string} files
 * @returns {Record<string, string>}
 */
export function loadSafe(...files) {
  return files.reduce((env, file) => {
    try {
      return mergeFirstWins(env, readEnvFile(file));
    } catch {
      return env;
    }
  }, {});
}

/**
 * Load env files (default `.env`) into `process.env` without overriding
 * variables that are already set.
 * @param {string} [file]
 * @param {...string} files
 * @returns {Record<string, string>}
 */
export function config(file = '.env', ...files) {
  const env = loadSafe(file, ...files);
  mergeFirstWins(process.env, env);
  return env;
}

const dotenv = { parse, stringify, load, loadSafe, config };

export default dotenv;
