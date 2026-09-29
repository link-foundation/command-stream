// Trace function for verbose logging
// Can be controlled via COMMAND_STREAM_VERBOSE or COMMAND_STREAM_TRACE env vars
// Can be disabled per-command via trace: false option
// CI environment no longer auto-enables tracing

/**
 * Log trace messages for debugging
 * @param {string} category - The category of the trace message
 * @param {string|function} messageOrFunc - The message or a function that returns the message
 * @param {object} runner - Optional runner object to check for trace option
 */
export function trace(category, messageOrFunc, runner = null) {
  // Check if runner explicitly disabled tracing
  if (runner && runner.options && runner.options.trace === false) {
    return;
  }

  // Check global trace setting (evaluated dynamically for runtime changes)
  const TRACE_ENV = process.env.COMMAND_STREAM_TRACE;
  const VERBOSE_ENV = process.env.COMMAND_STREAM_VERBOSE === 'true';

  // COMMAND_STREAM_TRACE=false explicitly disables tracing even if COMMAND_STREAM_VERBOSE=true
  // COMMAND_STREAM_TRACE=true explicitly enables tracing
  // Otherwise, use COMMAND_STREAM_VERBOSE
  const VERBOSE =
    TRACE_ENV === 'false' ? false : TRACE_ENV === 'true' ? true : VERBOSE_ENV;

  if (!VERBOSE) {
    return;
  }

  const message =
    typeof messageOrFunc === 'function' ? messageOrFunc() : messageOrFunc;
  const timestamp = new Date().toISOString();
  console.error(`[TRACE ${timestamp}] [${category}] ${message}`);
}
