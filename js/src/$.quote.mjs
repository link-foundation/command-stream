// Shell quoting and command building utilities
// Handles safe interpolation of values into shell commands

import { trace } from './$.trace.mjs';

/**
 * Quote a value for safe shell interpolation
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

  // If the value is already properly quoted and doesn't need further escaping,
  // check if we can use it as-is or with simpler quoting
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    // If it's already single-quoted and doesn't contain unescaped single quotes in the middle,
    // we can potentially use it as-is
    const inner = value.slice(1, -1);
    if (!inner.includes("'")) {
      // The inner content has no single quotes, so the original quoting is fine
      return value;
    }
  }

  if (value.startsWith('"') && value.endsWith('"') && value.length > 2) {
    // If it's already double-quoted, wrap it in single quotes to preserve it
    return `'${value}'`;
  }

  // Check if the string needs quoting at all
  // Safe characters: alphanumeric, dash, underscore, dot, slash, colon, equals, comma, plus
  // This regex matches strings that DON'T need quoting
  const safePattern = /^[a-zA-Z0-9_\-./=,+@:]+$/;

  if (safePattern.test(value)) {
    // The string is safe and doesn't need quoting
    return value;
  }

  // Default behavior: wrap in single quotes and escape any internal single quotes
  // This handles spaces, special shell characters, etc.
  return `'${value.replace(/'/g, "'\\''")}'`;
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
      return commandStr;
    }
  }

  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (
        v &&
        typeof v === 'object' &&
        Object.prototype.hasOwnProperty.call(v, 'raw')
      ) {
        trace(
          'Utils',
          () =>
            `BRANCH: buildShellCommand => RAW_VALUE | ${JSON.stringify({ value: String(v.raw) }, null, 2)}`
        );
        out += String(v.raw);
      } else {
        const quoted = quote(v);
        trace(
          'Utils',
          () =>
            `BRANCH: buildShellCommand => QUOTED_VALUE | ${JSON.stringify({ original: v, quoted }, null, 2)}`
        );
        out += quoted;
      }
    }
  }

  trace(
    'Utils',
    () =>
      `buildShellCommand EXIT | ${JSON.stringify({ command: out }, null, 2)}`
  );
  return out;
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
 * Pump a readable stream, calling onChunk for each chunk
 * @param {Readable} readable - Readable stream
 * @param {function} onChunk - Callback for each chunk
 */
export async function pumpReadable(readable, onChunk) {
  if (!readable) {
    trace('Utils', () => 'pumpReadable: No readable stream provided');
    return;
  }
  trace('Utils', () => 'pumpReadable: Starting to pump readable stream');
  for await (const chunk of readable) {
    const { asBuffer } = await import('./$.stream-utils.mjs');
    await onChunk(asBuffer(chunk));
  }
  trace('Utils', () => 'pumpReadable: Finished pumping readable stream');
}
