#!/usr/bin/env node

/**
 * Tracing System Overview
 *
 * The command-stream library includes comprehensive tracing for CI debugging.
 * Instead of one large test, each aspect is tested in separate focused examples:
 *
 * Individual Tracing Examples:
 * - trace-simple-command.mjs     - Basic command execution
 * - trace-signal-handling.mjs    - Process killing and SIGINT handling
 * - trace-abort-controller.mjs   - AbortController integration
 * - trace-stderr-output.mjs      - Stdout/stderr stream handling
 * - trace-pipeline-command.mjs   - Pipeline command execution
 * - trace-error-handling.mjs     - Error conditions and cleanup
 *
 * Usage for any example:
 *   COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-[example-name].mjs
 *
 * For CI debugging, enable tracing in your test runs:
 *   COMMAND_STREAM_TRACE=ProcessRunner bun test
 */

console.log('Tracing System Overview');
console.log('='.repeat(50));
console.log('');
console.log('The tracing system provides detailed logs for:');
console.log('• Process creation and spawning');
console.log('• Signal handling and process killing');
console.log('• Stdin/stdout/stderr handling');
console.log('• Virtual command execution');
console.log('• Cleanup operations');
console.log('• Error conditions');
console.log('• Platform-specific behavior differences');
console.log('');
console.log('Run individual examples to test specific areas:');
console.log('');
console.log(
  'COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-simple-command.mjs'
);
console.log(
  'COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-signal-handling.mjs'
);
console.log(
  'COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-abort-controller.mjs'
);
console.log(
  'COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-stderr-output.mjs'
);
console.log(
  'COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-pipeline-command.mjs'
);
console.log(
  'COMMAND_STREAM_TRACE=ProcessRunner node js/examples/trace-error-handling.mjs'
);
console.log('');
console.log('💡 Use COMMAND_STREAM_TRACE=* to see all tracing categories');
console.log('💡 Add COMMAND_STREAM_VERBOSE=true for even more detail');
