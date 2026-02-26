---
'command-stream': patch
---

Document try/catch anti-pattern with errexit=false default (issue #156)

- Add js/docs/case-studies/issue-156/README.md with comprehensive case study including:
  - Reconstructed timeline and sequence of events from calculator#78 silent bug
  - Root cause analysis with code evidence from command-stream source
  - Bash vs command-stream behavior comparison table
  - Full configuration API documentation (shell.errexit(), set(), unset())
  - Recommended patterns for mixed strict/optional error handling
  - Comparison with similar libraries (execa, zx, bash, child_process)
  - Proposed solutions ranked by impact
- Add Pitfall #7 to js/BEST-PRACTICES.md: try/catch anti-pattern with errexit=false, with examples and correct fix patterns
- Add 4 reproducible experiment scripts in experiments/issue-156/:
  - 01-default-behavior.mjs — demonstrates default errexit=false behavior
  - 02-errexit-enabled.mjs — demonstrates shell.errexit(true) configuration
  - 03-bash-comparison.sh — bash set -e reference comparison
  - 04-calculator-bug-repro.mjs — exact reproduction of calculator#78 bug
