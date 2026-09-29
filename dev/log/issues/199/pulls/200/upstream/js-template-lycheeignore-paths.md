`links.yml` runs the link checker for changes to `**.md`, `**.html` and the
workflow file itself:

```yaml
# .github/workflows/links.yml
on:
  push:
    branches: [main]
    paths:
      - '**.md'
      - '**.html'
      - '.github/workflows/links.yml'
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - '**.md'
      - '**.html'
      - '.github/workflows/links.yml'
```

Two inputs the job actually reads are missing from both lists:

- `.lycheeignore`, which the lychee step loads on every run,
- `scripts/check-web-archive.mjs`, which the job executes when lychee reports a
  broken link.

The Rust template lists all four ([`rust-ai-driven-development-pipeline-template/.github/workflows/links.yml`](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/blob/main/.github/workflows/links.yml)):

```yaml
    paths:
      - '**.md'
      - '**.html'
      - '.github/workflows/links.yml'
      - '.lycheeignore'
      - 'scripts/check-web-archive.mjs'
      - 'scripts/check-web-archive.test.mjs'
      - 'scripts/fixtures/lychee-report.md'
```

## Why it matters

`.lycheeignore` is the documented escape hatch for a false positive — the
failure message the workflow prints says so itself:

```
echo "     c. Add the URL to .lycheeignore if it is a known false positive."
```

Following that instruction does not work on a pull request whose only change is
the ignore entry. `Check Links` does not start, so the red result stays as it
was: with the job listed as a required check the pull request cannot go green
from the branch at all, and without it the author sees a stale failure and has
to push an unrelated `.md` edit, or run the workflow by hand, to clear it.

The same gap hides a real regression: `scripts/check-web-archive.mjs` runs
inside this workflow, and a change to it does not trigger the workflow that
runs it.

## Reproduction

1. On a branch, add a line to `.lycheeignore` and change nothing else.
2. Open a pull request.
3. `Check Links` is not among the checks — the `paths:` filter matched nothing.

## Workaround

Push a whitespace change to any `.md` file in the same pull request, or trigger
the workflow manually through `workflow_dispatch`.

## Suggested fix

Add the missing inputs to both `paths:` lists, as the Rust template already
does:

```diff
   push:
     branches: [main]
     paths:
       - '**.md'
       - '**.html'
       - '.github/workflows/links.yml'
+      - '.lycheeignore'
+      - 'scripts/check-web-archive.mjs'
   pull_request:
     types: [opened, synchronize, reopened]
     paths:
       - '**.md'
       - '**.html'
       - '.github/workflows/links.yml'
+      - '.lycheeignore'
+      - 'scripts/check-web-archive.mjs'
```

`tests/links-workflow.test.js` is a natural place to keep it from drifting
again — it already parses this workflow, so an assertion that every file the
job reads appears in both `paths:` lists (and that the two lists are equal)
would fail today.

Found while auditing CI/CD against this template for
link-foundation/command-stream#199.
