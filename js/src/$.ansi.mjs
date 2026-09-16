// ANSI control character utilities for command-stream
// Handles stripping and processing of ANSI escape codes

import { trace } from './$.trace.mjs';

/**
 * ANSI control character utilities
 */
export const AnsiUtils = {
  /**
   * Strip ANSI escape codes from text
   * @param {string} text - Text to process
   * @returns {string} Text without ANSI codes
   */
  stripAnsi(text) {
    if (typeof text !== 'string') {
      return text;
    }
    return text.replace(/\x1b\[[0-9;]*[mGKHFJ]/g, '');
  },

  /**
   * Strip control characters from text (preserving newlines, carriage returns, tabs)
   * @param {string} text - Text to process
   * @returns {string} Text without control characters
   */
  stripControlChars(text) {
    if (typeof text !== 'string') {
      return text;
    }
    // Preserve newlines (\n = \x0A), carriage returns (\r = \x0D), and tabs (\t = \x09)
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  },

  /**
   * Strip both ANSI codes and control characters
   * @param {string} text - Text to process
   * @returns {string} Cleaned text
   */
  stripAll(text) {
    if (typeof text !== 'string') {
      return text;
    }
    // Preserve newlines (\n = \x0A), carriage returns (\r = \x0D), and tabs (\t = \x09)
    return text.replace(
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\x1b\[[0-9;]*[mGKHFJ]/g,
      ''
    );
  },

  /**
   * Clean data for processing (handles both Buffer and string)
   * @param {Buffer|string} data - Data to clean
   * @returns {Buffer|string} Cleaned data
   */
  cleanForProcessing(data) {
    if (Buffer.isBuffer(data)) {
      return Buffer.from(this.stripAll(data.toString('utf8')));
    }
    return this.stripAll(data);
  },
};

// Global ANSI configuration
let globalAnsiConfig = {
  preserveAnsi: true,
  preserveControlChars: true,
};

/**
 * Configure global ANSI handling
 * @param {object} options - Configuration options
 * @param {boolean} options.preserveAnsi - Whether to preserve ANSI codes
 * @param {boolean} options.preserveControlChars - Whether to preserve control chars
 * @returns {object} Current configuration
 */
export function configureAnsi(options = {}) {
  trace(
    'AnsiUtils',
    () => `configureAnsi() called | ${JSON.stringify({ options }, null, 2)}`
  );
  globalAnsiConfig = { ...globalAnsiConfig, ...options };
  trace(
    'AnsiUtils',
    () => `New ANSI config | ${JSON.stringify({ globalAnsiConfig }, null, 2)}`
  );
  return globalAnsiConfig;
}

/**
 * Get current ANSI configuration
 * @returns {object} Current configuration
 */
export function getAnsiConfig() {
  trace(
    'AnsiUtils',
    () =>
      `getAnsiConfig() returning | ${JSON.stringify({ globalAnsiConfig }, null, 2)}`
  );
  return { ...globalAnsiConfig };
}

/**
 * Reset ANSI configuration to defaults
 */
export function resetAnsiConfig() {
  globalAnsiConfig = {
    preserveAnsi: true,
    preserveControlChars: true,
  };
  trace('AnsiUtils', () => 'ANSI config reset to defaults');
}

/**
 * Process output data according to current ANSI configuration
 * @param {Buffer|string} data - Data to process
 * @param {object} options - Override options
 * @returns {Buffer|string} Processed data
 */
export function processOutput(data, options = {}) {
  trace(
    'AnsiUtils',
    () =>
      `processOutput() called | ${JSON.stringify(
        {
          dataType: typeof data,
          dataLength: Buffer.isBuffer(data) ? data.length : data?.length,
          options,
        },
        null,
        2
      )}`
  );
  const config = { ...globalAnsiConfig, ...options };
  if (!config.preserveAnsi && !config.preserveControlChars) {
    return AnsiUtils.cleanForProcessing(data);
  } else if (!config.preserveAnsi) {
    return Buffer.isBuffer(data)
      ? Buffer.from(AnsiUtils.stripAnsi(data.toString('utf8')))
      : AnsiUtils.stripAnsi(data);
  } else if (!config.preserveControlChars) {
    return Buffer.isBuffer(data)
      ? Buffer.from(AnsiUtils.stripControlChars(data.toString('utf8')))
      : AnsiUtils.stripControlChars(data);
  }
  return data;
}
