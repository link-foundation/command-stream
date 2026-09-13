// Stream utility functions for safe operations and error handling
// Provides cross-runtime compatible stream operations

import { trace } from './$.trace.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

// Stream utility functions for safe operations and error handling
export const StreamUtils = {
  /**
   * Check if a stream is safe to write to
   * @param {object} stream - The stream to check
   * @returns {boolean} Whether the stream is writable
   */
  isStreamWritable(stream) {
    return stream && stream.writable && !stream.destroyed && !stream.closed;
  },

  /**
   * Add standardized error handler to stdin streams
   * @param {object} stream - The stream to add handler to
   * @param {string} contextName - Name for trace logging
   * @param {function} onNonEpipeError - Optional callback for non-EPIPE errors
   */
  addStdinErrorHandler(stream, contextName = 'stdin', onNonEpipeError = null) {
    if (stream && typeof stream.on === 'function') {
      stream.on('error', (error) => {
        const handled = this.handleStreamError(
          error,
          `${contextName} error event`,
          false
        );
        if (!handled && onNonEpipeError) {
          onNonEpipeError(error);
        }
      });
    }
  },

  /**
   * Safely write to a stream with comprehensive error handling
   * @param {object} stream - The stream to write to
   * @param {Buffer|string} data - The data to write
   * @param {string} contextName - Name for trace logging
   * @returns {boolean} Whether the write was successful
   */
  safeStreamWrite(stream, data, contextName = 'stream') {
    if (!this.isStreamWritable(stream)) {
      trace(
        'ProcessRunner',
        () =>
          `${contextName} write skipped - not writable | ${JSON.stringify(
            {
              hasStream: !!stream,
              writable: stream?.writable,
              destroyed: stream?.destroyed,
              closed: stream?.closed,
            },
            null,
            2
          )}`
      );
      return false;
    }

    try {
      const result = stream.write(data);
      trace(
        'ProcessRunner',
        () =>
          `${contextName} write successful | ${JSON.stringify(
            {
              dataLength: data?.length || 0,
            },
            null,
            2
          )}`
      );
      return result;
    } catch (error) {
      if (error.code !== 'EPIPE') {
        trace(
          'ProcessRunner',
          () =>
            `${contextName} write error | ${JSON.stringify(
              {
                error: error.message,
                code: error.code,
                isEPIPE: false,
              },
              null,
              2
            )}`
        );
        throw error; // Re-throw non-EPIPE errors
      } else {
        trace(
          'ProcessRunner',
          () =>
            `${contextName} EPIPE error (ignored) | ${JSON.stringify(
              {
                error: error.message,
                code: error.code,
                isEPIPE: true,
              },
              null,
              2
            )}`
        );
      }
      return false;
    }
  },

  /**
   * Safely end a stream with error handling
   * @param {object} stream - The stream to end
   * @param {string} contextName - Name for trace logging
   * @returns {boolean} Whether the end was successful
   */
  safeStreamEnd(stream, contextName = 'stream') {
    if (!this.isStreamWritable(stream) || typeof stream.end !== 'function') {
      trace(
        'ProcessRunner',
        () =>
          `${contextName} end skipped - not available | ${JSON.stringify(
            {
              hasStream: !!stream,
              hasEnd: stream && typeof stream.end === 'function',
              writable: stream?.writable,
            },
            null,
            2
          )}`
      );
      return false;
    }

    try {
      stream.end();
      trace('ProcessRunner', () => `${contextName} ended successfully`);
      return true;
    } catch (error) {
      if (error.code !== 'EPIPE') {
        trace(
          'ProcessRunner',
          () =>
            `${contextName} end error | ${JSON.stringify(
              {
                error: error.message,
                code: error.code,
              },
              null,
              2
            )}`
        );
      } else {
        trace(
          'ProcessRunner',
          () =>
            `${contextName} EPIPE on end (ignored) | ${JSON.stringify(
              {
                error: error.message,
                code: error.code,
              },
              null,
              2
            )}`
        );
      }
      return false;
    }
  },

  /**
   * Setup comprehensive stdin handling (error handler + safe operations)
   * @param {object} stream - The stream to setup
   * @param {string} contextName - Name for trace logging
   * @returns {{ write: function, end: function, isWritable: function }}
   */
  setupStdinHandling(stream, contextName = 'stdin') {
    this.addStdinErrorHandler(stream, contextName);

    return {
      write: (data) => this.safeStreamWrite(stream, data, contextName),
      end: () => this.safeStreamEnd(stream, contextName),
      isWritable: () => this.isStreamWritable(stream),
    };
  },

  /**
   * Handle stream errors with consistent EPIPE behavior
   * @param {Error} error - The error to handle
   * @param {string} contextName - Name for trace logging
   * @param {boolean} shouldThrow - Whether to throw non-EPIPE errors
   * @returns {boolean} Whether the error was an EPIPE (handled gracefully)
   */
  handleStreamError(error, contextName, shouldThrow = true) {
    if (error.code !== 'EPIPE') {
      trace(
        'ProcessRunner',
        () =>
          `${contextName} error | ${JSON.stringify(
            {
              error: error.message,
              code: error.code,
              isEPIPE: false,
            },
            null,
            2
          )}`
      );
      if (shouldThrow) {
        throw error;
      }
      return false;
    } else {
      trace(
        'ProcessRunner',
        () =>
          `${contextName} EPIPE error (ignored) | ${JSON.stringify(
            {
              error: error.message,
              code: error.code,
              isEPIPE: true,
            },
            null,
            2
          )}`
      );
      return true; // EPIPE handled gracefully
    }
  },

  /**
   * Detect if stream supports Bun-style writing
   * @param {object} stream - The stream to check
   * @returns {boolean}
   */
  isBunStream(stream) {
    return isBun && stream && typeof stream.getWriter === 'function';
  },

  /**
   * Detect if stream supports Node.js-style writing
   * @param {object} stream - The stream to check
   * @returns {boolean}
   */
  isNodeStream(stream) {
    return stream && typeof stream.write === 'function';
  },

  /**
   * Write to either Bun or Node.js style stream
   * @param {object} stream - The stream to write to
   * @param {Buffer|string} data - The data to write
   * @param {string} contextName - Name for trace logging
   * @returns {Promise<boolean>} Whether the write was successful
   */
  async writeToStream(stream, data, contextName = 'stream') {
    if (this.isBunStream(stream)) {
      try {
        const writer = stream.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return true;
      } catch (error) {
        return this.handleStreamError(
          error,
          `${contextName} Bun writer`,
          false
        );
      }
    } else if (this.isNodeStream(stream)) {
      try {
        stream.write(data);
        return true;
      } catch (error) {
        return this.handleStreamError(
          error,
          `${contextName} Node writer`,
          false
        );
      }
    }
    return false;
  },
};

/**
 * Safe write to a stream with parent stream monitoring
 * @param {object} stream - The stream to write to
 * @param {Buffer|string} data - The data to write
 * @param {object} processRunner - Optional ProcessRunner for parent stream handling
 * @param {function} monitorParentStreams - Function to call for monitoring
 * @returns {boolean} Whether the write was successful
 */
export function safeWrite(
  stream,
  data,
  processRunner = null,
  monitorParentStreams = null
) {
  if (monitorParentStreams) {
    monitorParentStreams();
  }

  if (!StreamUtils.isStreamWritable(stream)) {
    trace(
      'ProcessRunner',
      () =>
        `safeWrite skipped - stream not writable | ${JSON.stringify(
          {
            hasStream: !!stream,
            writable: stream?.writable,
            destroyed: stream?.destroyed,
            closed: stream?.closed,
          },
          null,
          2
        )}`
    );

    if (
      processRunner &&
      processRunner._handleParentStreamClosure &&
      (stream === process.stdout || stream === process.stderr)
    ) {
      processRunner._handleParentStreamClosure();
    }

    return false;
  }

  try {
    return stream.write(data);
  } catch (error) {
    trace(
      'ProcessRunner',
      () =>
        `safeWrite error | ${JSON.stringify(
          {
            error: error.message,
            code: error.code,
            writable: stream.writable,
            destroyed: stream.destroyed,
          },
          null,
          2
        )}`
    );

    if (
      error.code === 'EPIPE' &&
      processRunner &&
      processRunner._handleParentStreamClosure &&
      (stream === process.stdout || stream === process.stderr)
    ) {
      processRunner._handleParentStreamClosure();
    }

    return false;
  }
}

/**
 * Convert data to Buffer
 * @param {Buffer|string|object} chunk - Data to convert
 * @returns {Buffer} The data as a Buffer
 */
export function asBuffer(chunk) {
  if (chunk === null || chunk === undefined) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8');
  }
  // Handle ArrayBuffer and other views
  if (chunk instanceof Uint8Array || chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }
  // Handle objects with toString
  if (typeof chunk.toString === 'function') {
    return Buffer.from(chunk.toString(), 'utf8');
  }
  return Buffer.from(String(chunk), 'utf8');
}
