# CI/CD

Seven workflows guard this repository. Everything below is enforced by
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
| `security.yml`  | push to `main`, pull request, **weekly**, dispatch | CodeQL, dependency review, npm/bun/cargo audit, secret scan                                                                            |
| `quality.yml`   | push to `main`, pull request, dispatch             | formatting of every tracked file, documentation validation, workflow invariants                                                        |
| `links.yml`     | **weekly**, dispatch                               | external link check (lychee)                                                                                                           |

Every workflow except `quality.yml` and `links.yml` is scoped by a `paths:`
filter. The union of those filters is not the repository, which is why
`quality.yml` has no filter at all: a pull request that only touches `docs/**`
still runs the three checks that read the whole tree.

## Invariants

- **Warnings are errors.** `eslint --max-warnings 0`; `RUSTFLAGS`/`RUSTDOCFLAGS`
  are `-Dwarnings` and clippy runs with `-- -D warnings`, because `RUSTFLAGS`
  does not reach clippy's own lints. `cargo doc --no-deps` catches the
  rustdoc-only lints that neither clippy nor `cargo test --doc` reports.
- **actionlint runs from `docker://rhysd/actionlint`,** not from a bare binary.
  The Docker image bundles shellcheck and pyflakes; a binary without shellcheck
  on `PATH` silently skips every `run:` block and still exits 0.
- **zizmor runs at `--min-confidence low`, not `medium`.** `artipacked` — a
  checkout that leaves the job token in `.git/config` — is a Low-confidence
  audit, so `medium` hides every one of them. At `low` a checkout either sets
  `persist-credentials: false` or is one of the six release jobs that pushes
  with that credential and says so inline; the hygiene test asserts both, and
  the suppression count, so a seventh cannot appear by copy-paste.
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
- **A pull-request job that reads the tree merges the base branch first.**
  A pull-request run checks out `refs/pull/N/merge`, computed when the branch
  was last synchronised; if `main` moved since, the checks pass on a combination
  that will not exist after the merge.
  `.github/scripts/simulate-fresh-merge.sh` closes that window and turns a merge
  conflict into a clear failure. Five jobs are exempt, each with the reason
  recorded next to it and in the hygiene test: `changeset-check`, the Rust
  changelog checks and `parity` are diff-based, `dependency-review` compares two
  SHAs through the API, and CodeQL uploads results keyed to the checked-out
  commit — GitHub rejects a merge commit created on the runner.
- **A workflow's `push:` and `pull_request:` path filters are identical.** Two
  lists that drift mean a check runs on the pull request and then not on the
  merge to `main`, or the reverse, so a green pull request stops predicting a
  green `main`.
- **Every quality gate that ships is invoked.** `rust/scripts/` held a
  file-size, a crate-size and a version-modification check that no workflow ran;
  the hygiene test now fails when a script under `rust/scripts/` is neither
  referenced by a workflow nor listed as deliberately unwired.
- **The tree is scanned for committed credentials.** secretlint runs over every
  file on each pull request; `.secretlintrc.json` holds the rule set and
  `.secretlintignore` only the generated trees. Neither CodeQL nor the audit
  jobs look for secrets.
- **Documentation is validated like code.** `js/tests/docs-validation.test.mjs`
  enforces a 2500-line ceiling, resolves every relative link, and checks that
  the documents other automation points readers at still carry their sections.
  External links are deliberately out of scope for that test; they are checked
  separately, below.
- **External links are checked weekly, not on pull requests.** Both pipeline
  templates run lychee as a pull-request gate. The same job here reports 20
  errors on an unmodified tree, and all 20 are links that are correct in the
  document and unreachable from a runner: npmjs.com answers `403` to any
  non-browser client, and GitHub serves the stargazers list and the `/settings/`
  pages only to a signed-in session. So the check is split by who can break the
  link. Relative links — the only ones a change here can break — are resolved
  offline on every pull request; the network is fetched by `links.yml` on a
  schedule, where a failure means a link that used to work has stopped working
  and blocks no merge. `.lycheeignore` carries the known-unreachable URLs, one
  commented entry each, and the hygiene test rejects an uncommented one.
- **The duplication gate has a threshold just above the current measurement.**
  jscpd's `format` is the list of _languages_ to analyse, not the reporter; it
  read `"console"`, matched no file and passed in under a millisecond. With the
  language list corrected the tree measures 4.84 % of lines and 5.55 % of tokens
  duplicated, so the threshold is `6`: high enough not to fail on code that was
  already there, low enough that adding duplication fails the job.
  `js/tests/duplication-check.test.mjs` pins both the language list and the
  threshold range.
- **Lint and format configuration lives at the repository root.** eslint and
  prettier treat the directory holding their config as the project base path;
  while these files lived in `js/`, root-level JavaScript was outside that path
  and silently unlintable. `js/eslint.config.js` remains the rule set the root
  copies re-export, and `js.yml`'s trigger lists the root-level files eslint
  reaches (`eslint.config.js`, `claude-profiles.mjs`, `experiments/**`) so a
  lint error in them cannot first surface on an unrelated pull request.

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
