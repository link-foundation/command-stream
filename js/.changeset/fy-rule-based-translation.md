---
'command-stream': minor
---

Add the `$fy` virtual command, a shell-to-JavaScript translator built as a
rule-based translation on top of link-foundation/meta-language: the script is
first formalized as a links network, then rewritten into a command-stream module
by a `TranslationRuleSet`. Pipelines, `&&`/`||`, `if`/`while`/`until`/`for`/`case`,
functions, redirects, assignments and `${...}` expansions translate structurally
rather than textually, and untranslated constructs are reported as diagnostics.
