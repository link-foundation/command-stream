# Issue 160 Case Study: Separate JavaScript and Rust

## Source Data

- Issue: <https://github.com/link-foundation/command-stream/issues/160>
- Pull request: <https://github.com/link-foundation/command-stream/pull/161>
- Template snapshots:
  - JavaScript template `2d77e242d1a1778b6fc7f3ca563b2a36ef555d0e`
  - Rust template `702ea4036aea61b65652c8137b5480d50e710864`
  - Python template `66abe798182316d568e748bec4b0e89828fac1a6`
  - C# template `6872708aa3da13d5a67338cc8350c610c3af2275`
- Raw issue, PR, tree, template, and verification data is stored in
  [data/](data/) and [templates/](templates/).

## Requirements

| Requirement                      | Resolution                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Put JavaScript files under `js/` | Moved package metadata, lock files, changesets, scripts, changelog, lint/format config, and README into `js/`.                        |
| Put Rust files under `rust/`     | Kept crate files under `rust/`, added Rust README, changelog, changelog fragments, and Rust release scripts under `rust/scripts/`.    |
| Keep repository root common-only | Replaced the root README with shared project information and language links; removed root JS package/release files.                   |
| Control JS with `js.yml`         | Replaced the combined release workflow with `.github/workflows/js.yml`, scoped to `js/**`, shared files, and JS npm release behavior. |
| Control Rust with `rust.yml`     | Added `.github/workflows/rust.yml`, scoped to `rust/**`, shared files, and crates.io release behavior.                                |
| Separate package READMEs         | Added `js/README.md` for npm package docs and `rust/README.md` for crate docs; root README links both.                                |
| Separate releases and badges     | JS releases use `js-v<version>` tags and npm badges; Rust releases use `rust-v<version>` tags and crates.io badges.                   |
| Per-language scripts             | JS npm scripts live in `js/scripts/`; Rust release scripts live in `rust/scripts/`.                                                   |
| Compare CI/CD templates          | Captured file trees and script snapshots from JS, Rust, Python, and C# templates under `templates/`.                                  |
| Report template issues found     | Opened Rust template issue <https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/65>.               |
| Add reproducing test             | Added `js/tests/repository-layout.test.mjs`; before log failed, after log passes.                                                     |

## External Facts Used

- GitHub Actions supports `paths` filters on `push` and `pull_request`, so
  separate `js/**` and `rust/**` workflow triggers are appropriate:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpaths-paths-ignore>
- npm `package.json` `files` controls package tarball inclusion from the package
  root, and README/LICENSE/main files have special inclusion behavior:
  <https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files>
- npm trusted publishing uses OIDC from authorized CI/CD workflows, which
  matches the JavaScript workflow's `id-token: write` release path:
  <https://docs.npmjs.com/trusted-publishers/>
- Cargo's `readme` field is relative to `Cargo.toml` and is published to the
  registry, so `rust/Cargo.toml` now uses `readme = "README.md"`:
  <https://doc.rust-lang.org/cargo/reference/manifest.html#the-readme-field>
- Cargo recommends `cargo package`/`cargo publish --dry-run` style verification
  before publishing, which is why `rust.yml` keeps a package check:
  <https://doc.rust-lang.org/cargo/reference/publishing.html#packaging-a-crate>

## Template Comparison

The JavaScript template keeps npm release state in root-level package files,
`.changeset/`, `scripts/*.mjs`, and `.github/workflows/release.yml`. For this
repository, those same conventions were translated into `js/` so package-local
commands still run from the JavaScript package root while CI triggers remain
language-scoped.

The former repository-root `scripts/` directory was fully removed. JavaScript
release scripts were moved to `js/scripts/`; `scripts/publish-to-crates.mjs`
was replaced by `rust/scripts/publish-crate.rs`; and
`scripts/sync-rust-version.mjs` was removed because JavaScript and Rust now use
independent release versions handled by their own version-and-commit scripts.

The Rust template keeps `Cargo.toml`, `CHANGELOG.md`, `changelog.d/`, and
`scripts/*.rs` together. This repository already had the Rust crate under
`rust/`, so the template scripts were copied into `rust/scripts/` and adapted
for a nested crate root.

The Python and C# templates were used as cross-checks for common release
patterns: per-language changelog/changeset validation, package-manager-specific
publish scripts, explicit version-and-commit steps, and release-note generation.
They did not require repository changes because this issue only asks for
JavaScript and Rust separation.

## Design Decisions

1. Keep one repository and two package roots.
   This satisfies the issue without splitting history or changing package names.

2. Keep release workflows separate.
   Separate path filters and release tags reduce accidental cross-language
   releases and make package status visible in GitHub Actions.

3. Keep tests rooted at the repository where they already assumed repo-relative
   fixture paths.
   JS package scripts run `cd .. && bun test js/tests/...`, preserving existing
   behavior after moving `bunfig.toml` into `js/`. Explicit `--timeout 10000`
   keeps the previous timeout behavior.

4. Use manifest paths for Rust publishing.
   The copied Rust template used `cargo publish -p <name>`, which assumes a
   workspace. The adapted script uses `--manifest-path rust/Cargo.toml`, which
   works for this nested single-crate layout.

5. Remove consumed Rust changelog fragments.
   The Rust template version script collected fragments but did not delete them,
   which can cause repeat releases from the same fragments. This repository now
   removes consumed fragments and stages `rust/changelog.d/` with `git add -A`.

## Verification

Reproducing layout test:

- Before: `repository-layout-before.log` failed because JS package files and the
  combined release workflow still lived at the repository root.
- After: `repository-layout-after.log` passes with 4 tests and 30 assertions.

JavaScript checks:

- `js-lint.log`: `cd js && bun run lint`
- `js-format-check.log`: `cd js && bun run format:check`
- `js-duplication.log`: `cd js && bun run check:duplication`
- `js-test.log`: `cd js && PATH=/tmp/issue-160-bin:$PATH bun run test`
  - Result: 684 pass, 5 skip, 0 fail.
  - Note: local sudo was unavailable, so a temporary `jq` binary was downloaded
    for parity with `js.yml`, which installs `jq` on CI runners.

Rust checks:

- `rust-fmt.log`: `cd rust && cargo fmt --all -- --check`
- `rust-clippy.log`: `cd rust && cargo clippy --all-targets --all-features`
- `rust-test.log`: `cd rust && cargo test --all-features --verbose`
- `rust-doc-test.log`: `cd rust && cargo test --doc --all-features --verbose`
- `rust-package.log`: `cd rust && cargo package --allow-dirty`
- `rust-script-publish-crate-test.log`:
  `rust-script --test rust/scripts/publish-crate.rs`
- `rust-script-version-and-commit-test.log`:
  `rust-script --test rust/scripts/version-and-commit.rs`

Workflow checks:

- `workflow-yaml-parse.log`: Ruby YAML parse succeeded for `js.yml` and
  `rust.yml`.
- `actionlint` was not installed locally, so no actionlint run was recorded.

## Follow-up

The only upstream template issue found during this case study is tracked at
<https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/65>.
