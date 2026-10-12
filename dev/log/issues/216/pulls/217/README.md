# Issue 216 / PR 217 evidence

Where to start:
- [The analysis](analysis/REPORT.md): timeline, requirements, root causes, fixes, best-practices matrix and upstream reports.
- [Validation](analysis/VALIDATION.md).
- [Plan](analysis/plan.md).

Template comparison:
- [The complete file comparison](analysis/FILE-COMPARISON.md) and its CSV/JSON tables.
- [The template delta audit](analysis/TEMPLATE-DELTA-AUDIT.md), written before implementation.

Raw evidence:
- `github/`: issue, PR, run, job and annotation metadata.
- `ci-logs/`: compressed run logs.
- `research/`: CodeQL alerts at the start.
- `templates/`: pinned template snapshots and the CI/CD best-practices document.
- `upstream/`: bodies and URLs of the upstream reports.
- `validation/`: before/after reproductions and the final local checks. A log named `before` contains the original failure on purpose.

The scripts that produced the evidence are in `experiments/issue-216/`.
