---
'command-stream': patch
---

Reorganize codebase with modular utilities for better maintainability

- Extract trace/logging utilities to $.trace.mjs
- Extract shell detection to $.shell.mjs
- Extract stream utilities to $.stream-utils.mjs and $.stream-emitter.mjs
- Extract shell quoting to $.quote.mjs
- Extract result creation to $.result.mjs
- Extract ANSI utilities to $.ansi.mjs
- Extract global state management to $.state.mjs
- Extract shell settings to $.shell-settings.mjs
- Extract virtual command registration to $.virtual-commands.mjs
- Add commands/index.mjs for module exports
- Update $.utils.mjs to use shared trace module

All new modules follow the 1500-line limit guideline. The Rust code
structure already follows best practices with tests in separate files.
