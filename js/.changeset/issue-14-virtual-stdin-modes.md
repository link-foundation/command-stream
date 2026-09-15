---
'command-stream': patch
---

Stop stdio mode keywords from becoming virtual command input. The `stdin`
option carries either input data or one of `inherit`, `ignore` and `pipe`, but
both virtual command runners treated any string as data, so `` await $`cat` ``
returned the literal `"inherit"`. Piped input now also wins over the pipeline's
own `stdin` option instead of being overwritten by it.
