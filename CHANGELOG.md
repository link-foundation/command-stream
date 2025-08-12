# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2024-01-XX

### Added
- Initial release of command-stream
- Modern $ shell utility library with streaming support
- Multiple usage patterns: classic await, async iteration, EventEmitter, and mixed patterns
- Real-time streaming of command output
- Bun runtime optimization with Node.js compatibility
- Memory-efficient streaming to prevent large buffer accumulation
- Backward compatible with existing `await $` syntax
- Comprehensive test suite with 90.42% line coverage and 95.45% function coverage
- Support for stdin/stdout/stderr handling
- Cross-platform compatibility (macOS, Linux, Windows)
- Node.js 20+ compatibility (20, 22, 24)
- EventEmitter-like interface for real-time command monitoring
- Built-in security with automatic shell escaping
- Promise interface with then/catch/finally support
- Stream properties for direct access to child process streams

### Features
- `$` tagged template function for command execution
- `sh()` function for shell command execution
- `exec()` function for direct program execution
- `run()` function for simplified command running
- `create()` function for custom $ instances with default options
- `quote()` utility for safe shell argument quoting
- `raw()` utility for raw string interpolation
- ProcessRunner class with full EventEmitter support
- Async iteration support via `stream()` method
- Multiple stdin handling modes (inherit, ignore, string, Buffer)
- Configurable options for mirroring, capturing, and environment variables

[Unreleased]: https://github.com/link-foundation/command-stream/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/link-foundation/command-stream/releases/tag/v0.0.1