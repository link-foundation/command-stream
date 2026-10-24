# Command Stream for VS Code

The extension highlights shell code in `$` templates, completes built-in and
locally registered virtual command names, shows command documentation on hover,
and reports unclosed literal shell quotes. JavaScript expressions inside `${}`
remain JavaScript. Install `command-stream` for its TypeScript declarations;
VS Code's JavaScript and TypeScript services provide argument and API errors.

Run **Command Stream: Start REPL** from the command palette. An active Rust file
opens `repl --language rust`; other files open the JavaScript REPL. Rust mode
requires [Evcxr and Rust sources](../../js/docs/INTERACTIVE-DEVELOPMENT.md).
Rust syntax and compiler diagnostics remain provided by Rust editor tooling.
From this directory,
run `npm run package`, then install the generated VSIX using VS Code's
**Extensions: Install from VSIX** command. The extension has no runtime
dependencies beyond VS Code. The manifest is ready for publication; marketplace
publication and download metrics require the publisher's account.
