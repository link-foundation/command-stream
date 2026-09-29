---
'command-stream': minor
---

Add a Bun.$-compatible shell for Node.js, Bun and Deno: `import { $ } from 'command-stream/bun'`(also`require('command-stream/bun')`and`$.bun`). It is a portable port of the Bun Shell interpreter (lexer, parser, brace/glob expansion, pipelines, subshells, `if`, `&&`/`||`, redirects, command substitution, variables, and the builtins `cd`, `echo`, `pwd`, `export`, `exit`, `true`, `false`, `which`, `basename`, `dirname`, `seq`, `yes`, `ls`, `rm`, `mkdir`, `touch`, `mv`, `cat`, `cp`) with Bun's JavaScript API (`ShellPromise` with `.text()`, `.json()`, `.lines()`, `.bytes()`, `.blob()`, `.quiet()`, `.nothrow()`, `.cwd()`, `.env()`; `ShellOutput`, `ShellError`, `new $.Shell()`, `$.escape`, `$.braces`, `$.file`). It passes the whole Bun Shell conformance corpus (`conformance/bun-shell/`, recorded from Bun's own shell tests) byte for byte on Node.js, Bun and Deno, on Linux, macOS and Windows.
