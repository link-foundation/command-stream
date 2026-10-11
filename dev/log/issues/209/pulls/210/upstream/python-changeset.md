Found against template commit `1e2f475cb411e857f83f769f13887ae2df0656b2101` during [command-stream #209](https://github.com/link-foundation/command-stream/issues/209).

The docstring in `scripts/validate_changeset.py` documents exit 1 for source changes without a fragment. `main()` instead returns 0 whenever the directory contains no fragments, and scans all pre-existing fragments without inspecting the PR diff. The source explicitly labels the no-fragment case advisory, so either the documented contract or implementation must change.

Offline reproduction:

```bash
python3 experiments/issue-209/probe-python-changeset.py
```

[Fixture](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/experiments/issue-209/probe-python-changeset.py) copies the pinned script into a temporary project with `src/code.py` and no fragments. [Output](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/dev/log/issues/209/pulls/210/validation/template-python-changeset-before.log.gz): warning, exit 0.

Workaround: add an enforcing CI wrapper that determines changed source files and requires an added `changelog.d/*.md` fragment. Documentation-only changes can remain exempt.

Suggested fix: compare the PR against a verified Git merge base, fail on missing refs, count only `--diff-filter=A` fragments, validate their contents, and return 1 for changed package code without a fragment. Alternatively rename/document an explicitly advisory mode and make enforcement selectable, with tests for both modes. [Scriv](https://scriv.readthedocs.io/en/latest/) remains suitable for fragment generation/collection; it does not replace the PR-diff gate.
