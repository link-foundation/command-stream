# Case Study: Apostrophe Over-Escaping (Issue #141)

## Overview

This case study documents the issue where apostrophes in text arguments are over-escaped when passed through command-stream, causing them to appear as triple quotes (`'''`) when the text is stored or displayed literally by receiving programs.

## Problem Statement

When passing text containing apostrophes through command-stream in double-quoted template literals, apostrophes are escaped using Bash's `'\''` pattern. When the receiving command (like `gh` CLI) passes this text to an API that stores it literally, the escape sequences appear as visible characters.

### Example

```javascript
const releaseNotes = "Fix bug when dependencies didn't exist";
await $`gh release create v1.0.0 --notes "${releaseNotes}"`;
// GitHub receives: "Fix bug when dependencies didn'\''t exist"
// GitHub displays: "Fix bug when dependencies didn'''t exist"
```

## Timeline of Investigation

1. **Initial report**: Issue observed in production with GitHub release notes
2. **Related issue**: First documented in test-anywhere repository (issue #135)
3. **Workaround implemented**: Using `gh api` with JSON stdin instead of shell arguments
4. **Root cause identified**: Double-quoting when users add quotes around interpolated values

## Root Cause Analysis

### The Escaping Mechanism

The `quote()` function in command-stream (js/src/$.mjs:1056-1100) handles shell escaping:

```javascript
function quote(value) {
  // ... null/array handling ...

  // Default: wrap in single quotes, escape internal single quotes
  return `'${value.replace(/'/g, "'\\''")}'`;
}
```

For input `didn't`, this produces `'didn'\''t'`, which is the correct Bash escaping for a single quote inside a single-quoted string.

### The Double-Quoting Issue

When users write:

```javascript
await $`command "${text}"`;
```

The template literal contains `"` characters as static strings. The `buildShellCommand()` function then:

1. Adds the static string `command "`
2. Calls `quote(text)` which wraps in single quotes
3. Adds the closing static string `"`

Result: `command "'escaped'\''text'"`

This creates double-quoting - the user's `"..."` plus the library's `'...'`.

### Experimental Evidence

```
Test: Direct shell (baseline)
Command: /tmp/show-args.sh "Text with apostrophe's"
Result: [Text with apostrophe's] ✅

Test: With user-provided quotes (the bug)
Command: $`/tmp/show-args.sh "${testText}"`
Result: ['Dependencies didn'\''t exist'] ❌

Test: Without user quotes (correct usage)
Command: $`/tmp/show-args.sh ${testText}`
Result: [Dependencies didn't exist] ✅
```

### Why Triple Quotes Appear

When a program receives `'didn'\''t'`:

1. If it **interprets** as shell → expands to `didn't` ✅
2. If it **stores literally** → keeps as `'didn'\''t'` which displays as `didn'''t` ❌

The `gh` CLI passes arguments to GitHub's API, which stores them literally without shell interpretation.

## Solutions

### Solution 1: Correct Usage (No User Quotes)

The simplest solution is to not add quotes around interpolated values:

```javascript
// ❌ Wrong - double quoting
await $`gh release create --notes "${text}"`;

// ✅ Correct - let command-stream quote
await $`gh release create --notes ${text}`;
```

### Solution 2: literal() Function (Proposed)

Add a `literal()` function for cases where text should not be shell-escaped:

```javascript
import { $, literal } from 'command-stream';

// Mark text as literal - minimal escaping for argument boundary only
await $`gh release create --notes ${literal(releaseNotes)}`;
```

This would:

- Apply only the minimal escaping needed for argument boundaries
- Not apply Bash-specific patterns like `'\''`
- Be useful when the receiving program stores text literally

### Solution 3: Use stdin with JSON (Recommended for APIs)

For API calls, pass data via stdin:

```javascript
const payload = JSON.stringify({
  tag_name: 'v1.0.0',
  body: releaseNotes,
});

await $`gh api repos/owner/repo/releases -X POST --input -`.run({
  stdin: payload,
});
```

This completely bypasses shell escaping issues.

## Implementation Decision

Based on the issue suggestions and analysis:

1. **Implement `literal()` function** - For marking text that should not be shell-escaped
2. **Improve documentation** - Clarify when and how shell escaping occurs
3. **Add examples** - Show correct usage patterns and workarounds

## Related Issues and References

- **Issue #141**: This issue - Apostrophe over-escaping
- **Issue #45**: Automatic quote addition in interpolation
- **Issue #49**: Complex shell commands with nested quotes
- **test-anywhere #135**: First observed occurrence
- **test-anywhere PR #136**: Workaround using stdin/JSON

## Lessons Learned

1. Shell escaping and literal text storage are incompatible
2. Users should not add quotes around interpolated values
3. For API calls, JSON/stdin is the safest approach
4. Clear documentation and examples are essential

## Test Cases

A proper fix should handle:

| Input                | Expected Output      |
| -------------------- | -------------------- |
| `didn't`             | `didn't`             |
| `it's user's choice` | `it's user's choice` |
| `text is "quoted"`   | `text is "quoted"`   |
| `it's "great"`       | `it's "great"`       |
| `` use `npm` ``      | `` use `npm` ``      |
| `Line 1\nLine 2`     | `Line 1\nLine 2`     |
