// Shell quoting and command building utilities
// Handles safe interpolation of values into shell commands

import { trace } from './$.trace.mjs';

// ---------------------------------------------------------------------------
// Pre-quoted passthrough (legacy, off by default)
//
// Older versions treated a value that happened to start and end with a quote
// character as "already quoted" and spliced it into the command as shell
// syntax, so the value `'/My Documents/x'` reached the command as
// `/My Documents/x` - the quotes vanished. sh does the opposite: `"$var"`
// always yields the value verbatim, quote characters included, which is also
// what Bun's $, zx and execa do. Worse, the heuristic could hand the shell
// unbalanced quotes: `"' ; touch pwned ; '"` was spliced in as-is and the
// injected command ran (issue #41).
//
// The heuristic is therefore off by default. Set
// COMMAND_STREAM_PREQUOTED_PASSTHROUGH=1 (or call
// setPreQuotedPassthroughEnabled(true)) to restore it for code that relied on
// hand-quoted values; even then only values that stay balanced are passed
// through, so the injection above can no longer happen.
// ---------------------------------------------------------------------------

let preQuotedPassthroughEnabled = null;

/**
 * Enable or disable the legacy pre-quoted passthrough heuristic.
 * @param {boolean|null} enabled - true/false to force, null to follow the env
 * @returns {boolean} The effective setting after the change
 */
export function setPreQuotedPassthroughEnabled(enabled) {
  preQuotedPassthroughEnabled = enabled === null ? null : Boolean(enabled);
  return isPreQuotedPassthroughEnabled();
}

/**
 * Whether the legacy pre-quoted passthrough heuristic is active.
 * @returns {boolean} true when enabled
 */
export function isPreQuotedPassthroughEnabled() {
  if (preQuotedPassthroughEnabled !== null) {
    return preQuotedPassthroughEnabled;
  }
  return process.env.COMMAND_STREAM_PREQUOTED_PASSTHROUGH === '1';
}

// Alphanumerics plus the punctuation a POSIX shell leaves alone; anything else
// (spaces above all) has to be quoted.
const SAFE_UNQUOTED_PATTERN = /^[a-zA-Z0-9_\-./=,+@:]+$/;

/**
 * Whether a value can be spliced into the command as-is under the legacy
 * pre-quoted passthrough heuristic, i.e. it is wrapped in matching quotes and
 * contains none of that quote character inside.
 * @param {string} value - Raw value
 * @returns {boolean} true when the value is balanced, quoted shell syntax
 */
function isBalancedQuotedValue(value) {
  const quoteChar = value[0];
  if ((quoteChar !== "'" && quoteChar !== '"') || value.length < 2) {
    return false;
  }
  const inner = value.slice(1, -1);
  return value.endsWith(quoteChar) && !inner.includes(quoteChar);
}

/**
 * Quote a value for safe shell interpolation.
 *
 * The value is always treated as literal text - exactly one argument, spaces
 * and quote characters included - which is what `"$var"` does in sh.
 *
 * @param {*} value - Value to quote
 * @returns {string} Safely quoted string
 */
export function quote(value) {
  if (value === null || value === undefined) {
    return "''";
  }
  if (Array.isArray(value)) {
    return value.map(quote).join(' ');
  }
  if (typeof value !== 'string') {
    value = String(value);
  }
  if (value === '') {
    return "''";
  }

  if (isPreQuotedPassthroughEnabled() && isBalancedQuotedValue(value)) {
    // Legacy: the caller quoted the value themselves, so use it as shell syntax.
    return value;
  }

  if (SAFE_UNQUOTED_PATTERN.test(value)) {
    // The string is safe and doesn't need quoting
    return value;
  }

  // Wrap in single quotes and escape any internal single quotes. This handles
  // spaces, quote characters, and every other shell metacharacter.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Quote-context aware interpolation
//
// A tagged template can place an interpolation inside quotes the author wrote
// themselves, e.g. $`bash -c "${script}"`. Wrapping the value in single quotes
// there (the default for an unquoted position) produces `bash -c "'...'"`,
// which the inner shell then refuses to run (issue #49).
//
// Instead we mirror what a POSIX shell does with "$var": the value is inserted
// as literal text *inside* the quotes the author opened, escaped just enough
// that it cannot terminate them or introduce new syntax. That keeps
// interpolation injection-safe while making quoted positions behave the way
// bash/sh users expect, which is also what Bun's $ does.
// ---------------------------------------------------------------------------

/** Interpolation happens outside any quotes; value gets fully quoted. */
export const CONTEXT_UNQUOTED = 'unquoted';
/** Interpolation happens inside '...' written in the template. */
export const CONTEXT_SINGLE = 'single';
/** Interpolation happens inside "..." written in the template. */
export const CONTEXT_DOUBLE = 'double';

// Context-aware quoting is on by default. It can be disabled globally with
// COMMAND_STREAM_QUOTE_CONTEXT=0 (or programmatically via
// setQuoteContextEnabled) to restore the pre-0.20 behaviour of always
// single-quoting interpolated values.
let quoteContextEnabled = null;

/**
 * Enable or disable quote-context aware interpolation.
 * @param {boolean|null} enabled - true/false to force, null to follow the env
 * @returns {boolean} The effective setting after the change
 */
export function setQuoteContextEnabled(enabled) {
  quoteContextEnabled = enabled === null ? null : Boolean(enabled);
  return isQuoteContextEnabled();
}

/**
 * Whether quote-context aware interpolation is currently active.
 * @returns {boolean} true when enabled
 */
export function isQuoteContextEnabled() {
  if (quoteContextEnabled !== null) {
    return quoteContextEnabled;
  }
  return process.env.COMMAND_STREAM_QUOTE_CONTEXT !== '0';
}

/**
 * Advance the shell quoting state across a literal chunk of a template.
 *
 * Only the template's own text is scanned - interpolated values never change
 * the state, which is exactly why they cannot break out of their quotes.
 *
 * @param {string} text - Literal template chunk
 * @param {string} context - Context in effect before the chunk
 * @returns {string} Context in effect after the chunk
 */
export function scanQuoteContext(text, context = CONTEXT_UNQUOTED) {
  let current = context;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (current === CONTEXT_SINGLE) {
      // Inside '...' nothing is special except the closing quote.
      if (char === "'") {
        current = CONTEXT_UNQUOTED;
      }
      continue;
    }
    if (current === CONTEXT_DOUBLE) {
      // Inside "..." a backslash escapes the next character.
      if (char === '\\') {
        i++;
        continue;
      }
      if (char === '"') {
        current = CONTEXT_UNQUOTED;
      }
      continue;
    }
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === "'") {
      current = CONTEXT_SINGLE;
    } else if (char === '"') {
      current = CONTEXT_DOUBLE;
    }
  }
  return current;
}

/**
 * Escape a value so it can sit inside '...' as literal text.
 *
 * A single quote is emitted as '\'' - close, escaped quote, reopen - which is
 * the standard POSIX idiom.
 *
 * @param {string} value - Raw value
 * @returns {string} Escaped fragment (no surrounding quotes)
 */
export function escapeForSingleQuotes(value) {
  return value.replace(/'/g, "'\\''");
}

/**
 * Escape a value so it can sit inside "..." as literal text.
 *
 * Backslash, dollar, backtick and double quote are the only characters the
 * shell still interprets inside double quotes, so escaping them makes the
 * value literal - the inner program (e.g. `bash -c`) sees the original text.
 *
 * @param {string} value - Raw value
 * @returns {string} Escaped fragment (no surrounding quotes)
 */
export function escapeForDoubleQuotes(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"');
}

/**
 * Quote a value for a specific quoting context.
 *
 * In an unquoted position this is plain {@link quote}. Inside quotes the value
 * is inserted as escaped literal text, without adding another layer of quotes.
 *
 * @param {*} value - Value to interpolate
 * @param {string} context - One of CONTEXT_UNQUOTED / CONTEXT_SINGLE / CONTEXT_DOUBLE
 * @returns {string} Fragment to splice into the command
 */
export function quoteForContext(value, context = CONTEXT_UNQUOTED) {
  if (context === CONTEXT_UNQUOTED) {
    return quote(value);
  }
  // Inside quotes an unset value expands to nothing, just like "$missing".
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    // Matches "${array[*]}" in sh: one word, elements separated by spaces.
    return value.map((v) => quoteForContext(v, context)).join(' ');
  }
  const text = typeof value === 'string' ? value : String(value);
  return context === CONTEXT_SINGLE
    ? escapeForSingleQuotes(text)
    : escapeForDoubleQuotes(text);
}

// Remember which split-template snippets we've already warned about so a hot
// loop doesn't spam stderr with the same diagnostic over and over.
const warnedTemplateSnippets = new Set();

/**
 * Scan a fully-built command string for an unquoted Go/Handlebars-style
 * template token (`{{ ... }}`) that contains an unquoted space.
 *
 * Such a token is split by the shell (and by command-stream, which mirrors
 * shell word-splitting) into multiple argv words, so `--format {{json .X}}`
 * reaches the child as `--format`, `{{json`, `.X}}` — exactly what a POSIX
 * shell would do, but surprising for Go templates. We return the offending
 * snippet so the caller can point the user at the gotcha.
 *
 * @param {string} command - The assembled command string
 * @returns {string|null} The split template snippet, or null if none
 */
export function findSplitTemplateToken(command) {
  if (typeof command !== 'string' || !command.includes('{{')) {
    return null;
  }

  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (inSingle) {
      inSingle = char !== "'";
      continue;
    }
    if (inDouble) {
      inDouble = char !== '"';
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      continue;
    }

    // An unquoted `{{` — scan forward for its matching `}}`, reporting it when
    // an unquoted space appears in between (which is what triggers splitting).
    if (char === '{' && command[i + 1] === '{') {
      const close = scanTemplateClose(command, i + 2);
      if (close.splits) {
        return command.slice(i, close.endIndex + 2);
      }
      i = close.endIndex;
    }
  }

  return null;
}

/**
 * Starting just after an unquoted `{{`, scan to the matching unquoted `}}`,
 * tracking whether an unquoted space appears in between.
 *
 * @param {string} command - The command string
 * @param {number} startIndex - Index just past the opening `{{`
 * @returns {{ splits: boolean, endIndex: number }} `splits` is true when a
 *   closing `}}` was found with an intervening unquoted space; `endIndex`
 *   points at the closing `}}` (or the end of input).
 */
function scanTemplateClose(command, startIndex) {
  let j = startIndex;
  let hasUnquotedSpace = false;
  let inSingle = false;
  let inDouble = false;
  while (j < command.length) {
    const cj = command[j];
    if (inSingle) {
      inSingle = cj !== "'";
    } else if (inDouble) {
      inDouble = cj !== '"';
    } else if (cj === "'") {
      inSingle = true;
    } else if (cj === '"') {
      inDouble = true;
    } else if (cj === '}' && command[j + 1] === '}') {
      return { splits: hasUnquotedSpace, endIndex: j };
    } else if (/\s/.test(cj)) {
      hasUnquotedSpace = true;
    }
    j++;
  }
  return { splits: false, endIndex: j };
}

/**
 * Emit a one-line diagnostic when a built command contains an unquoted Go
 * template token with an internal space. This points users at the
 * shell-splitting gotcha behind the cryptic downstream errors (e.g. Go's
 * "unclosed action"). Silenced via COMMAND_STREAM_NO_TEMPLATE_WARNING=1, and
 * each unique snippet is only reported once per process.
 *
 * @param {string} command - The assembled command string
 */
function warnOnSplitTemplate(command) {
  if (process.env.COMMAND_STREAM_NO_TEMPLATE_WARNING) {
    return;
  }
  const snippet = findSplitTemplateToken(command);
  if (!snippet || warnedTemplateSnippets.has(snippet)) {
    return;
  }
  warnedTemplateSnippets.add(snippet);
  console.error(
    `[command-stream] Warning: template token \`${snippet}\` contains an ` +
      `unquoted space, so the shell splits it into multiple arguments (just ` +
      `like bash would). Quote it ('${snippet}') or interpolate it as a ` +
      `single \${value} to pass it as one argument. See README ` +
      `"Go templates & {{ }} arguments". Set ` +
      `COMMAND_STREAM_NO_TEMPLATE_WARNING=1 to silence.`
  );
}

/**
 * Build a shell command from template strings and values
 * @param {string[]} strings - Template literal strings
 * @param {*[]} values - Interpolated values
 * @returns {string} Complete shell command
 */
export function buildShellCommand(strings, values) {
  trace(
    'Utils',
    () =>
      `buildShellCommand ENTER | ${JSON.stringify(
        {
          stringsLength: strings.length,
          valuesLength: values.length,
        },
        null,
        2
      )}`
  );

  // Special case: if we have a single value with empty surrounding strings,
  // and the value looks like a complete shell command, treat it as raw
  if (
    values.length === 1 &&
    strings.length === 2 &&
    strings[0] === '' &&
    strings[1] === '' &&
    typeof values[0] === 'string'
  ) {
    const commandStr = values[0];
    // Check if this looks like a complete shell command (contains spaces and shell-safe characters)
    const commandPattern = /^[a-zA-Z0-9_\-./=,+@:\s"'`$(){}<>|&;*?[\]~\\]+$/;
    if (commandPattern.test(commandStr) && commandStr.trim().length > 0) {
      trace(
        'Utils',
        () =>
          `BRANCH: buildShellCommand => COMPLETE_COMMAND | ${JSON.stringify({ command: commandStr }, null, 2)}`
      );
      warnOnSplitTemplate(commandStr);
      return commandStr;
    }
  }

  const contextAware = isQuoteContextEnabled();
  let context = CONTEXT_UNQUOTED;
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (contextAware) {
      context = scanQuoteContext(strings[i], context);
    }
    if (i < values.length) {
      out += formatInterpolatedValue(values[i], context);
    }
  }

  trace(
    'Utils',
    () =>
      `buildShellCommand EXIT | ${JSON.stringify({ command: out }, null, 2)}`
  );
  warnOnSplitTemplate(out);
  return out;
}

/**
 * Format a single interpolated value for a shell command: raw values are
 * inserted verbatim, { literal } values are double-quoted, everything else is
 * quoted for the context it appears in.
 * @param {*} v - Interpolated value
 * @param {string} [context] - Quoting context at the interpolation point
 * @returns {string} Formatted fragment
 */
function formatInterpolatedValue(v, context = CONTEXT_UNQUOTED) {
  const isWrapper = (key) =>
    v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, key);

  if (isWrapper('raw')) {
    trace(
      'Utils',
      () =>
        `BRANCH: buildShellCommand => RAW_VALUE | ${JSON.stringify({ value: String(v.raw) }, null, 2)}`
    );
    return String(v.raw);
  }

  if (isWrapper('literal')) {
    // Inside quotes the extra pair of double quotes quoteLiteral() adds would
    // land in the middle of the author's own quoting, so escape for the
    // surrounding context instead - the resulting text is identical.
    const literalQuoted =
      context === CONTEXT_UNQUOTED
        ? quoteLiteral(v.literal)
        : quoteForContext(v.literal, context);
    trace(
      'Utils',
      () =>
        `BRANCH: buildShellCommand => LITERAL_VALUE | ${JSON.stringify({ original: v.literal, quoted: literalQuoted, context }, null, 2)}`
    );
    return literalQuoted;
  }

  const quoted = quoteForContext(v, context);
  trace(
    'Utils',
    () =>
      `BRANCH: buildShellCommand => QUOTED_VALUE | ${JSON.stringify({ original: v, quoted, context }, null, 2)}`
  );
  return quoted;
}

/**
 * Mark a value as raw (not to be quoted)
 * @param {*} value - Value to mark as raw
 * @returns {{ raw: string }} Raw value wrapper
 */
export function raw(value) {
  trace('API', () => `raw() called with value: ${String(value).slice(0, 50)}`);
  return { raw: String(value) };
}

/**
 * Quote a value using double quotes - preserves apostrophes as-is.
 *
 * Use this when the text will be passed to programs that store it literally
 * (like API calls via CLI tools) rather than interpreting it as shell commands.
 *
 * In double quotes, we only need to escape: $ ` \ " and newlines
 * Apostrophes (') are preserved without escaping.
 *
 * @param {*} value - The value to quote
 * @returns {string} - The double-quoted string with proper escaping
 */
export function quoteLiteral(value) {
  if (value === null || value === undefined) {
    return '""';
  }
  if (Array.isArray(value)) {
    return value.map(quoteLiteral).join(' ');
  }
  if (typeof value !== 'string') {
    value = String(value);
  }
  if (value === '') {
    return '""';
  }

  // Check if the string needs quoting at all
  if (SAFE_UNQUOTED_PATTERN.test(value)) {
    return value;
  }

  // Escape characters that are special inside double quotes: \ $ ` "
  // Apostrophes (') do NOT need escaping in double quotes
  const escaped = value
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/\$/g, '\\$') // Escape dollar signs (prevent variable expansion)
    .replace(/`/g, '\\`') // Escape backticks (prevent command substitution)
    .replace(/"/g, '\\"'); // Escape double quotes

  return `"${escaped}"`;
}

/**
 * Pump a readable stream, calling onChunk for each chunk.
 *
 * An optional AbortSignal can be supplied to stop pumping even while a read is
 * pending. This is required to recover from the case where a process has
 * exited but a grandchild keeps the stdio pipe open, which would otherwise
 * leave the pump (and the awaiting caller) hanging forever (issue #155).
 *
 * @param {Readable|ReadableStream} readable - Readable stream
 * @param {function} onChunk - Callback for each chunk
 * @param {AbortSignal} [signal] - Optional signal to abort pumping
 */
export async function pumpReadable(readable, onChunk, signal) {
  if (!readable) {
    trace('Utils', () => 'pumpReadable: No readable stream provided');
    return;
  }
  trace('Utils', () => 'pumpReadable: Starting to pump readable stream');
  const { asBuffer } = await import('./$.stream-utils.mjs');

  // Web/Bun ReadableStream: use an explicit reader so a pending read() can be
  // cancelled when the signal aborts.
  if (typeof readable.getReader === 'function') {
    const reader = readable.getReader();
    const onAbort = () => {
      Promise.resolve(reader.cancel()).catch(() => {});
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        await onChunk(asBuffer(value));
      }
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      reader.releaseLock?.();
    }
    trace('Utils', () => 'pumpReadable: Finished pumping readable stream');
    return;
  }

  // Node Readable: destroy() ends the async iteration when aborted.
  const onAbort = () => {
    try {
      readable.destroy();
    } catch {
      /* ignore */
    }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }
  try {
    for await (const chunk of readable) {
      await onChunk(asBuffer(chunk));
    }
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
  trace('Utils', () => 'pumpReadable: Finished pumping readable stream');
}
