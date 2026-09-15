---
'command-stream': minor
---

Add `tee` as a built-in virtual command. It was implemented but never
registered, so `` $`tee ...` `` fell through to the system binary. Follows GNU
coreutils: `-a`/`--append`, `-i`/`--ignore-interrupts`, clustered short flags,
`--` as an option terminator, a bare `-` treated as a file named `-`, and a
write failure reported on stderr with exit code 1 while the remaining files are
still written.

Also stop stdio mode keywords from becoming virtual command input. The `stdin`
option carries either input data or one of `inherit`, `ignore` and `pipe`, but
both virtual command runners treated any string as data, so `` await $`cat` ``
returned the literal `"inherit"`. Piped input now also wins over the pipeline's
own `stdin` option instead of being overwritten by it.
