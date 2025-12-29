---
'command-stream': minor
---

Add Rust translation and reorganize codebase

- Reorganize JavaScript source files into `js/` folder structure
- Move tests from root `tests/` to `js/tests/`
- Add complete Rust translation in `rust/` folder with:
  - Shell parser supporting &&, ||, ;, |, (), and redirections
  - All 21 virtual commands (cat, cp, mv, rm, touch, mkdir, ls, cd, pwd, echo, yes, seq, sleep, env, which, test, exit, basename, dirname, true, false)
  - ProcessRunner for async command execution with tokio
  - Comprehensive test suite mirroring JavaScript tests
  - Case study documentation in docs/case-studies/issue-146/
