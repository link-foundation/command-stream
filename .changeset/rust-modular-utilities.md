---
'command-stream': patch
---

Reorganize Rust code with modular utilities (matching JS pattern)

- Extract trace.rs (152 lines) - Logging and tracing utilities
- Extract ansi.rs (194 lines) - ANSI escape code handling
- Extract quote.rs (161 lines) - Shell quoting utilities
- Update utils.rs to re-export from new modules and focus on CommandResult/VirtualUtils
- Update lib.rs with new module declarations and re-exports

The Rust structure now mirrors the JavaScript modular organization for consistency.
All modules remain well under the 1500-line limit guideline.
