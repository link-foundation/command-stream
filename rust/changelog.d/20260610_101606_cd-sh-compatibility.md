---
bump: minor
---

### Changed
- Make the built-in `cd` command fully `sh`/bash compatible so shell scripts translate directly to Rust (issue #50):
  - `cd -` switches to the previous directory and prints it, like `sh`
  - `~` and `~/path` tilde expansion
  - a successful `cd` updates the `PWD` and `OLDPWD` environment variables
  - relative targets resolve against the `cwd` option for consistency
