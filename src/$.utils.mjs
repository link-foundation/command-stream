import path from 'path';

const VERBOSE = process.env.COMMAND_STREAM_VERBOSE === 'true';

export function trace(category, messageOrFunc) {
  if (!VERBOSE) return;
  const message = typeof messageOrFunc === 'function' ? messageOrFunc() : messageOrFunc;
  const timestamp = new Date().toISOString();
  console.error(`[TRACE ${timestamp}] [${category}] ${message}`);
}

export const VirtualUtils = {
  /**
   * Create standardized error response for missing operands
   */
  missingOperandError(commandName, customMessage = null) {
    const message = customMessage || `${commandName}: missing operand`;
    return { stderr: message, code: 1 };
  },

  /**
   * Create standardized error response for invalid arguments
   */
  invalidArgumentError(commandName, message) {
    return { stderr: `${commandName}: ${message}`, code: 1 };
  },

  /**
   * Create standardized success response
   */
  success(stdout = '', code = 0) {
    return { stdout, stderr: '', code };
  },

  /**
   * Create standardized error response
   */
  error(stderr = '', code = 1) {
    return { stdout: '', stderr, code };
  },

  /**
   * Validate that command has required number of arguments
   */
  validateArgs(args, minCount, commandName) {
    if (args.length < minCount) {
      if (minCount === 1) {
        return this.missingOperandError(commandName);
      } else {
        return this.invalidArgumentError(commandName, `requires at least ${minCount} arguments`);
      }
    }
    return null; // No error
  },

  /**
   * Resolve file path with optional cwd parameter
   */
  resolvePath(filePath, cwd = null) {
    const basePath = cwd || process.cwd();
    return path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath);
  },

  /**
   * Safe file system operation wrapper
   */
  async safeFsOperation(operation, errorPrefix) {
    try {
      return await operation();
    } catch (error) {
      return this.error(`${errorPrefix}: ${error.message}`);
    }
  },

  /**
   * Create async wrapper for Promise-based operations
   */
  createAsyncWrapper(promiseFactory) {
    return new Promise(promiseFactory);
  }
};