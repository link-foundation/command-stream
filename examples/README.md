# Command Stream Examples

This directory contains 160+ examples demonstrating various features of the command-stream library. Each example focuses on a specific concept or use case.

## Quick Start

The simplest examples to get started:
- `readme-example.mjs` - Basic usage from the main README
- `ping-streaming-simple.mjs` - Simple streaming example
- `syntax-basic-options.mjs` - Basic $({ options }) syntax

## Categories

### 🎛️ Options and Configuration

**$({ options }) Syntax:**
- `syntax-basic-options.mjs` - Basic options verification
- `syntax-custom-stdin.mjs` - Custom stdin using options
- `syntax-custom-environment.mjs` - Custom environment variables
- `syntax-custom-directory.mjs` - Custom working directory
- `syntax-combined-options.mjs` - Multiple options combined
- `syntax-reusable-configs.mjs` - Reusable configurations
- `syntax-mixed-usage.mjs` - Mix with regular $ usage
- `syntax-silent-operations.mjs` - Silent operations (no mirror)
- `syntax-stdin-option.mjs` - stdin option verification
- `syntax-command-chaining.mjs` - Command chaining verification
- `syntax-reusable-config.mjs` - Multiple uses of same config

**Capture/Mirror Options:**
- `capture-mirror-default.mjs` - Default behavior (both enabled)
- `capture-mirror-silent-processing.mjs` - capture: true, mirror: false
- `capture-mirror-show-only.mjs` - capture: false, mirror: true  
- `capture-mirror-performance.mjs` - capture: false, mirror: false
- `capture-mirror-comparison.mjs` - Summary of all combinations
- `options-capture-false.mjs` - Using .start() with capture: false
- `options-mirror-false.mjs` - Using .start() with mirror: false
- `options-combined-settings.mjs` - Using both mirror and capture options
- `options-default-behavior.mjs` - Default behavior comparison
- `options-performance-mode.mjs` - Maximum performance mode

**Performance Optimization:**
- `options-performance-optimization.mjs` - Disable capture for speed
- `options-silent-execution.mjs` - Disable mirroring
- `options-maximum-performance.mjs` - No capture, no mirror
- `options-custom-input.mjs` - Custom input with options

**Method Usage:**
- `methods-start-basic.mjs` - Using .start() method
- `methods-run-basic.mjs` - Using .run() method (identical to .start())
- `methods-multiple-options.mjs` - Both methods support same options
- `options-run-alias.mjs` - Using .run() alias with options
- `options-run-alias-demo.mjs` - Using .run() alias demonstration

### 📡 Streaming Examples

**Basic Streaming:**
- `streaming-direct-command.mjs` - Direct command streaming
- `streaming-silent-capture.mjs` - Long-running with silent capture
- `streaming-progress-tracking.mjs` - Progress tracking with streaming
- `streaming-filtered-output.mjs` - Stream processing with filtering
- `streaming-reusable-configs.mjs` - Reusable streaming configurations
- `streaming-interactive-stdin.mjs` - Interactive streaming with custom stdin

**Pipeline Streaming:**
- `streaming-jq-pipeline.mjs` - jq pipeline streaming (critical test)
- `streaming-multistage-pipeline.mjs` - Multi-stage pipeline (cat | jq)
- `streaming-grep-pipeline.mjs` - grep pipeline streaming
- `streaming-virtual-pipeline.mjs` - Virtual command with pipeline

**Advanced Streaming:**
- `streaming-pipes-realtime-jq.mjs` - Real-time streaming through jq
- `streaming-pipes-multistage.mjs` - Multi-stage pipeline streaming
- `streaming-pipes-event-pattern.mjs` - EventEmitter pattern with pipes
- `streaming-behavior-test.mjs` - Comprehensive streaming behavior analysis

**Options-Based Streaming:**
- `options-streaming-silent.mjs` - Silent streaming with $({ mirror: false })
- `options-streaming-stdin.mjs` - Custom stdin streaming
- `options-streaming-capture.mjs` - Capture enabled with streaming
- `options-streaming-multiple.mjs` - Multiple configured instances

### 🏓 Ping Examples

**Basic Ping:**
- `ping-streaming-simple.mjs` - Minimal ping streaming example
- `ping-streaming.mjs` - Enhanced ping with timestamps and parsing
- `ping-streaming-timestamps.mjs` - Basic ping with timestamps
- `ping-streaming-filtered.mjs` - Filtering only ping replies
- `ping-streaming-statistics.mjs` - Counting responses with statistics
- `ping-streaming-silent.mjs` - Silent streaming with options
- `ping-streaming-interruptible.mjs` - CTRL+C handling with streams

### 🎨 ANSI Color Handling

**Basic Color Examples:**
- `colors-default-preserved.mjs` - Default behavior (ANSI preserved)
- `colors-strip-ansi.mjs` - Using AnsiUtils.stripAnsi()
- `colors-buffer-processing.mjs` - Using AnsiUtils.cleanForProcessing()
- `colors-per-command-config.mjs` - Per-command ANSI configuration
- `ansi-default-preserved.mjs` - Default ANSI preservation
- `ansi-strip-utils.mjs` - Using AnsiUtils to strip ANSI
- `ansi-global-config.mjs` - Global configuration to disable ANSI
- `ansi-reset-default.mjs` - Reset to default (preserve ANSI)

**Interactive Examples:**
- `interactive-top.mjs` - Interactive `top` command with full ANSI support
- `interactive-top-fixed.mjs` - Fixed version of interactive top
- `interactive-top-improved.mjs` - Improved interactive top
- `interactive-top-pty.mjs` - Interactive top with PTY
- `interactive-top-pty-logging.mjs` - PTY with logging
- `interactive-top-with-logging.mjs` - Interactive top with logging
- `example-top.mjs` - Simple `top` command example
- `example-ansi-ls.mjs` - ls command ANSI color handling

**jq Color Examples:**
- `jq-colors-streaming.mjs` - jq streaming with ANSI colors
- `test-jq-colors.mjs` - Comprehensive jq color testing

### ⚡ Event-Based Processing

**Basic Events:**
- `events-ping-basic.mjs` - Basic event-based ping
- `events-stdin-input.mjs` - Event-based with custom stdin
- `events-progress-tracking.mjs` - Long-running process with progress events
- `events-error-handling.mjs` - Error handling and recovery
- `events-concurrent-streams.mjs` - Multiple concurrent event streams

**Real-World Event Patterns:**
- `events-log-processing.mjs` - Real-time log processing
- `events-file-monitoring.mjs` - File monitoring simulation
- `events-build-process.mjs` - Build process simulation
- `events-interactive-simulation.mjs` - Interactive command simulation
- `events-network-monitoring.mjs` - Network monitoring with multiple hosts

### 🚦 CTRL+C Signal Handling

**Basic Signal Handling:**
- `ctrl-c-long-running-command.mjs` - Long-running command interruption
- `ctrl-c-sleep-command.mjs` - Sleep command with signal handling
- `ctrl-c-stdin-forwarding.mjs` - Command with stdin forwarding
- `ctrl-c-real-system-command.mjs` - Real system command CTRL+C
- `ctrl-c-virtual-command.mjs` - Virtual command CTRL+C
- `ctrl-c-concurrent-processes.mjs` - Multiple concurrent processes

### 🔧 Syntax Comparisons

**Feature Comparisons:**
- `syntax-basic-comparison.mjs` - Basic $ vs $({ options }) comparison
- `syntax-piping-comparison.mjs` - Command chaining comparison
- `syntax-multiple-listeners.mjs` - Multiple event listeners comparison

### 🧪 Testing and Debugging

**Core Functionality Tests:**
- `test-stream-cleanup.mjs` - Stream cleanup behavior
- `test-cleanup-simple.mjs` - Simplified cleanup test
- `test-debug.mjs` - Debug version with internal state
- `test-events.mjs` - Event handling tests
- `test-raw-streaming.mjs` - Raw streaming (no jq) tests
- `test-bun-streaming.mjs` - Bun-specific streaming tests

**Pipeline Tests:**
- `test-simple-pipe.mjs` - Simple pipeline tests
- `test-sh-pipeline.mjs` - Shell pipeline tests
- `test-direct-pipe-reading.mjs` - Direct pipe reading tests
- `test-no-parse-pipeline.mjs` - No parse pipeline tests

**Virtual Command Tests:**
- `test-virtual-streaming.mjs` - Virtual command streaming tests
- `test-real-commands.mjs` - Real command tests
- `test-real-shell.mjs` - Real shell command tests

**Advanced Tests:**
- `test-incremental-streaming.mjs` - Incremental streaming tests
- `test-multi-stream.mjs` - Multiple stream tests
- `test-final-streaming.mjs` - Final streaming tests
- `test-streaming-final.mjs` - Streaming final tests
- `test-multistage-debug.mjs` - Multi-stage debug tests

**CTRL+C Tests:**
- `test-ctrl-c.mjs` - Basic CTRL+C tests
- `test-ctrl-c-debug.mjs` - CTRL+C debug tests
- `test-ctrl-c-inherit.mjs` - CTRL+C inheritance tests
- `test-ctrl-c-sleep.mjs` - CTRL+C sleep tests
- `test-interrupt.mjs` - Interrupt tests
- `test-parent-continues.mjs` - Parent continuation tests
- `manual-ctrl-c-test.mjs` - Manual CTRL+C test

**PTY and Interactive Tests:**
- `test-pty.mjs` - PTY tests
- `test-pty-spawn.mjs` - PTY spawn tests
- `test-debug-pty.mjs` - Debug PTY tests
- `test-interactive.mjs` - Interactive tests

**jq and JSON Tests:**
- `test-jq-compact.mjs` - jq compact tests
- `test-jq-realtime.mjs` - jq realtime tests
- `test-direct-jq.mjs` - Direct jq tests
- `simple-jq-streaming.mjs` - Simple jq streaming tests
- `realtime-json-stream.mjs` - Realtime JSON streaming

**Node.js Compatibility:**
- `node-compat-data-events.mjs` - Node.js spawn with data events
- `node-compat-readable-event.mjs` - Using readable event
- `node-compat-small-buffer.mjs` - Reading with small buffer size

**Debug and Analysis:**
- `debug-already-started.mjs` - Already started behavior
- `debug-ansi-processing.mjs` - ANSI processing debug
- `debug-event-vs-result.mjs` - Event vs result debug
- `debug-exact-command.mjs` - Exact command debug
- `debug-option-merging.mjs` - Option merging debug
- `debug-pipeline.mjs` - Pipeline debug
- `debug-pipeline-issue.mjs` - Pipeline issue debug
- `debug-pipeline-method.mjs` - Pipeline method debug
- `debug-simple.mjs` - Simple debug
- `debug-streaming.mjs` - Streaming debug
- `debug-virtual-vs-real.mjs` - Virtual vs real command debug

**Stream Analysis:**
- `test-stream-readers.mjs` - Stream readers tests
- `test-debug-tee.mjs` - Debug tee tests
- `test-debug-new-options.mjs` - Debug new options tests
- `test-individual-spawn.mjs` - Individual spawn tests
- `test-verbose.mjs` - Verbose tests
- `test-verbose2.mjs` - Verbose tests v2

**Emulation and Demos:**
- `emulate-claude-stream.mjs` - Claude streaming emulator
- `emulated-streaming-direct.mjs` - Direct emulator execution
- `emulated-streaming-jq-pipe.mjs` - Emulator piped through jq
- `emulated-streaming-sh-pipe.mjs` - Using sh -c with pipe
- `simple-stream-demo.mjs` - Simple streaming demo
- `working-streaming-demo.mjs` - Working streaming demonstration

**which Command Tests:**
- `which-command-gh-test.mjs` - Testing which gh (GitHub issue #7)
- `which-command-system-comparison.mjs` - Comparing with system which
- `which-command-common-commands.mjs` - Testing with common commands
- `which-command-nonexistent.mjs` - Testing non-existent commands

**Cat Command Tests:**
- `test-cat-direct.mjs` - Direct cat tests
- `test-cat-pipe.mjs` - Cat pipe tests

## Key Features Demonstrated

### 🎛️ Options and Configuration
- ✅ **$({ options }) syntax** - Clean API for passing options
- ✅ **Capture control** - Enable/disable output capture with `capture: true/false`
- ✅ **Mirror control** - Enable/disable terminal output with `mirror: true/false`
- ✅ **Custom stdin** - Pass custom input with `stdin` option
- ✅ **Environment variables** - Set custom environment with `env` option
- ✅ **Working directory** - Change directory with `cwd` option
- ✅ **Method aliases** - Use `.run()` as alias for `.start()`

### 📡 Real-Time Streaming
- ✅ **Async iteration** - `for await (const chunk of command.stream())`
- ✅ **Event-based processing** - `.on('stdout')`, `.on('stderr')`, `.on('close')`
- ✅ **Pipeline streaming** - Real-time streaming through jq, grep, sed
- ✅ **Multi-stage pipelines** - Complex command chains with streaming
- ✅ **Progress tracking** - Real-time progress monitoring

### 🎨 ANSI Color Handling
- ✅ **ANSI colors preserved by default** (addresses GitHub issue #10)
- ✅ **No interference with interactive I/O** (addresses GitHub issue #11)
- ✅ **Easy data processing** with `AnsiUtils` export functions
- ✅ **Configurable behavior** for different use cases
- ✅ **Stream compatibility** with existing tools

### 🚦 Signal Handling
- ✅ **CTRL+C forwarding** - Proper SIGINT signal forwarding to child processes
- ✅ **Process cleanup** - Clean termination without hanging processes
- ✅ **Interactive commands** - Full stdin/stdout/stderr inheritance
- ✅ **Virtual command cancellation** - Proper cleanup of async generators

### 🔧 Stream Management
- ✅ **Proper cleanup** - Breaking from `for await` loops properly terminates processes
- ✅ **No resource leaks** - Virtual commands are properly closed
- ✅ **Clean exit** - No hanging processes after iteration stops

## Usage Examples

```bash
# Run a basic example
bun examples/ping-streaming-simple.mjs

# Test ANSI color handling
node examples/colors-default-preserved.mjs

# Try CTRL+C signal handling
node examples/ctrl-c-long-running-command.mjs

# Test streaming with options
node examples/options-streaming-silent.mjs

# Event-based processing
node examples/events-log-processing.mjs
```

## File Naming Convention

Files are named using the pattern `{category}-{feature}-{variant}.mjs`:
- `ping-streaming-simple.mjs` - Simple ping streaming
- `options-capture-false.mjs` - Options with capture disabled
- `events-log-processing.mjs` - Event-based log processing
- `syntax-basic-options.mjs` - Basic syntax for options

This makes it easy to find related examples and understand what each file demonstrates at a glance.