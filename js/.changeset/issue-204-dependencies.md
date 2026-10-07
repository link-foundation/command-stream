---
'command-stream': major
---

Update all JavaScript runtime and development dependencies to their latest
stable releases, including Execa 10.1.0 and the ShellJS 0.10 declarations.
Execa 10 requires Node.js 22 or later; command-stream now requires Node.js 22.
The Node.js CI matrix covers 22, 24, and 26. Use node-pty's latest stable 1.1.0
release in place of the development prerelease.
Repair its packaged macOS spawn-helper's missing executable permission before
starting the PTY host so terminal capture continues to work on macOS.

Preserve the public execaCommand and execaCommandSync helpers with typed
wrappers around Execa 10. Update npm publishing to npm 12 and its supported
Node.js ranges. Refresh GitHub Actions dependencies.

Add dependency freshness CI for both language packages, Rust benchmarks, and
embedded release-script manifests, with verified open-issue blockers for Rust.
