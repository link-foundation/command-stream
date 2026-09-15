---
'command-stream': minor
---

Add `tee` as a built-in virtual command. It was implemented but never
registered, so `` $`tee ...` `` fell through to the system binary. Follows GNU
coreutils: `-a`/`--append`, `-i`/`--ignore-interrupts`, clustered short flags,
`--` as an option terminator, a bare `-` treated as a file named `-`, and a
write failure reported on stderr with exit code 1 while the remaining files are
still written.
