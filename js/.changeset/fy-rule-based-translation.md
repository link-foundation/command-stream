---
'command-stream': minor
---

Add the `$fy` virtual command, a shell-to-JavaScript translator built as a
rule-based translation on top of link-foundation/meta-language: the script is
first formalized as a links network, then rewritten into a command-stream module
by a `TranslationRuleSet`. Pipelines, `&&`/`||`, `if`/`while`/`until`/`for`/`case`,
functions, redirects, assignments and `${...}` expansions translate structurally
rather than textually, and untranslated constructs are reported as diagnostics.

Add source migration for zx, Execa, ShellJS, cross-spawn and Bun shell APIs.
The CLI defaults to lossless interpreter execution through command-stream +
use-m, supports stdin and source selection, and refuses to overwrite output.
Expose the rule-based APIs at command-stream/fy and cross-spawn compatibility
at command-stream/cross-spawn. Keep structural compilation under --structural.
