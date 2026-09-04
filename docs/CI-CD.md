# CI/CD

Five workflows guard this repository. Everything below is enforced by
`js/tests/workflow-hygiene.test.mjs` and `js/tests/repository-layout.test.mjs`,
which parse the workflow files themselves — if a job drifts from what this
document describes, those tests fail.

## Workflows

| Workflow        | Runs on                                            | Jobs                                                                                                                                   |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `js.yml`        | push to `main`, pull request, dispatch             | changeset check, lint and format, test (bun + node 20/22/24 × ubuntu/macos/windows), release, instant release, changeset PR            |
| `rust.yml`      | push to `main`, pull request, dispatch             | changelog fragment check, lint and format, test (ubuntu/macos/windows), release scripts, build, release, instant release, changelog PR |
| `parity.yml`    | pull request                                       | JS/Rust source parity                                                                                                                  |
| `workflows.yml` | push to `main`, pull request, dispatch             | actionlint, zizmor                                                                                                                     |
| `security.yml`  | push to `main`, pull request, **weekly**, dispatch | CodeQL, dependency review, npm/bun/cargo audit                                                                                         |

## Invariants

- **Warnings are errors.** `eslint --max-warnings 0`; `RUSTFLAGS`/`RUSTDOCFLAGS`
  are `-Dwarnings` and clippy runs with `-- -D warnings`, because `RUSTFLAGS`
  does not reach clippy's own lints. `cargo doc --no-deps` catches the
  rustdoc-only lints that neither clippy nor `cargo test --doc` reports.
- **actionlint runs from `docker://rhysd/actionlint`,** not from a bare binary.
  The Docker image bundles shellcheck and pyflakes; a binary without shellcheck
  on `PATH` silently skips every `run:` block and still exits 0.
- **zizmor audits `.github/workflows` only.** Its default input is `.`, which
  also collects the archived copies of other repositories' workflows under
  `docs/case-studies/**/templates/**`. Those never run here.
- **No secret is declared in a workflow-level `env:`.** That block is inherited
  by every job in the file, including the ones that compile pull-request code.
  Publishing credentials belong on the publishing job.
- **Only jobs that write hold a non-cancellable concurrency group.** Read-only
  checks use a cancellable `check-*` group; jobs with `contents: write` share
  `main-writer-${{ github.repository }}-main` and are never cancelled halfway.
- **Release jobs gate on `!cancelled()`, not `always()`.** A job with `needs:`
  is skipped when a dependency is skipped, and _any_ non-`success()` condition
  lifts that — so `always()` adds nothing except the risk of running after a
  real failure.
- **Lint and format configuration lives at the repository root.** eslint and
  prettier treat the directory holding their config as the project base path;
  while these files lived in `js/`, root-level JavaScript was outside that path
  and silently unlintable. `js/eslint.config.js` remains the rule set the root
  copies re-export.

## Required repository settings

Two things a workflow cannot configure. Both are open:

### Branch protection on `main`

`GET /repos/link-foundation/command-stream/branches/main/protection` returns
`404 Branch not protected` and the ruleset list is empty, so a pull request with
red checks can still be merged. Protect `main` and mark the lint, test and
security jobs as required.

### Dependency graph

`actions/dependency-review-action` needs the dependency graph, which is off for
this repository — the API reports no `dependency_graph` key and a `PATCH` to
enable it has no effect, so it is controlled at the organisation level. Enable
it at
<https://github.com/link-foundation/command-stream/settings/security_analysis>.

Until then the job probes the compare endpoint and skips with a warning rather
than failing on every pull request; it starts reviewing on its own once the
graph is on. Any other API status still fails the job. The npm, bun and cargo
audit jobs cover the committed lockfiles in the meantime.

## Releasing

JavaScript uses changesets: add a `js/.changeset/*.md` entry describing the
change and its bump type, or the `Check for JavaScript changesets` job fails.
Rust uses changelog fragments: add `rust/changelog.d/YYYYMMDD_HHMMSS_*.md` with
`bump:` frontmatter, or `Rust changelog fragment check` fails.

`scripts/publish-retry.mjs` treats an "already published" registry error as
success, including npm's E409 `Cannot publish over previously staged version` —
a slow-propagating publish used to be reported as a failed release even though
the version was live.
