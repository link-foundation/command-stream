# Changelog

## 0.8.2

### Patch Changes

- b3dac3d: Add Windows shell detection support
  - Added Windows-specific shell detection (Git Bash, PowerShell, cmd.exe)
  - Use 'where' command on Windows instead of 'which' for PATH lookups
  - Fallback to cmd.exe on Windows when no Unix-compatible shell is found
  - Updated timing expectations in tests for slower Windows shell spawning
  - Created case study documentation for Windows CI failures (Issue #144)

## 0.8.1

### Patch Changes

- Test patch release

## 0.8.0

### Minor Changes

- f4dbb49: Transition to new CI/CD template with modern best practices

  Features:
  - Changeset-based versioning for semantic version management
  - OIDC trusted publishing to npm (no tokens required)
  - Manual and automatic release workflows
  - Multi-platform testing (Ubuntu, macOS, Windows)
  - Node.js compatibility testing (v20, v22, v24)
  - ESLint + Prettier with Husky pre-commit hooks
  - Code duplication detection with jscpd
  - Consolidated release workflow for all publishing

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.7.1

### Patch Changes

- Current stable release with streaming support, async iteration, and EventEmitter support
