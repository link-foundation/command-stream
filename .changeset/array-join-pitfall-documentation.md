---
'command-stream': patch
---

Document Array.join() pitfall and add best practices (fixes #153)

- Add BEST-PRACTICES.md with detailed usage patterns for arrays, security, and error handling
- Add Common Pitfalls section to README.md explaining the Array.join() issue
- Add docs/case-studies/issue-153/ with real-world bug investigation from hive-mind#1096
- Add rust/BEST-PRACTICES.md for Rust-specific patterns
- Add 34 tests for array interpolation covering correct usage and anti-patterns
