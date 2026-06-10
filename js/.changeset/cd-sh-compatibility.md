---
'command-stream': minor
---

Make the built-in `cd` command fully `sh`/bash compatible so shell scripts translate directly to `.mjs` (issue #50):

- `cd -` switches to the previous directory and prints it, like `sh`
- `~` and `~/path` tilde expansion
- successful `cd` updates the `PWD` and `OLDPWD` environment variables
- relative targets resolve against the `cwd` option for consistency

Also documents the working-directory behavior (persistence across commands, subshell isolation, and `cd` vs. the `cwd` option) in the README.
