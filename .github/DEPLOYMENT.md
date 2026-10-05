# Deployment Setup

This repository has separate release workflows for each language package:

- JavaScript npm package: `.github/workflows/js.yml`
- Rust crates.io package: `.github/workflows/rust.yml`

The workflows run independently on pull requests and pushes that touch their
language folders, workflow files, or shared repository files.

## JavaScript Publishing

The JavaScript package lives in `js/` and is published to npm as
`command-stream`.

npm publishing uses trusted publishing through GitHub Actions OIDC. Configure
the trusted publisher in npm for:

- Repository: `link-foundation/command-stream`
- Workflow file: `.github/workflows/js.yml`
- Environment: none, unless the npm package is configured to require one

The JavaScript workflow uses `id-token: write`, runs npm release scripts from
`js/`, and creates GitHub releases tagged as `js-v<version>`.

JavaScript PRs that change package code must add exactly one changeset in
`js/.changeset/`.

## Rust Publishing

The Rust crate lives in `rust/` and is published to crates.io as
`command-stream`.

Configure one of these GitHub Actions secrets at the repository or organization
level:

- `CARGO_REGISTRY_TOKEN` - Cargo's native environment variable name, preferred
- `CARGO_TOKEN` - backwards-compatible fallback used by older organization
  workflows

The Rust workflow maps both names and runs Rust release scripts from
`rust/scripts/`. Rust GitHub releases are tagged as `rust-v<version>`.

Rust PRs that change crate code must add a changelog fragment in
`rust/changelog.d/`.

## Feature Documentation

The feature catalog in `js/examples/features/catalog.mjs` drives executable
examples for both language packages and the generated documentation in
`docs/`. Pull requests run every catalog entry with Node.js, Bun and Rust, then
verify that the committed guide is current.

Generate and validate the guide locally from the repository root:

```bash
node scripts/generate-docs.mjs
node scripts/check-parity.mjs
node scripts/generate-docs.mjs --check
```

After changes reach `main`, `.github/workflows/docs.yml` publishes
`docs/site/` to GitHub Pages. Configure the repository's Pages source as
**GitHub Actions** before the first deployment.

## Local Release Checks

JavaScript:

```bash
cd js
bun install
bun run lint
bun run format:check
bun run check:duplication
bun run test
```

Rust:

```bash
cd rust
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features --verbose
cargo test --doc --all-features --verbose
cargo package --allow-dirty
```

## Troubleshooting

- Missing JavaScript changeset: add one `js/.changeset/*.md` file.
- Missing Rust changelog: add one `rust/changelog.d/*.md` file.
- npm trusted publishing failure: verify npm trusted publisher settings match
  `.github/workflows/js.yml`.
- crates.io authentication failure: verify `CARGO_REGISTRY_TOKEN` or
  `CARGO_TOKEN` is available to Actions.
- crate version already exists: rerun the Rust workflow if a previous release
  partially completed; the Rust scripts check crates.io and GitHub release
  artifacts before deciding whether to bump.

## Release Preflight and Diagnostics

On `main`, the first lint job checks registry credentials before running package
checks. JavaScript exchanges a GitHub OIDC identity for a package-specific npm
publish token and discards it. Rust sends publish metadata without an archive to the crates.io publish endpoint.
The specific missing-archive response proves token authentication and publish
scopes passed; no crate can be published by this request. Actual publishing
remains the authoritative ownership check, including team ownership. Pull request jobs do not receive release credentials.

Pages needs a repository setting before the workflow can configure it. An
administrator can select **Settings → Pages → Source → GitHub Actions**, or run:

```bash
gh api --method POST repos/link-foundation/command-stream/pages -f build_type=workflow
```

`GITHUB_TOKEN` in a workflow cannot bootstrap this setting with its ordinary
Pages deployment permissions. The workflow checks the setting before installing
or building documentation.

Bun test jobs preserve console output and JUnit results in the `bun-tests-<OS>`
artifacts, including failures. Their step budget leaves time to upload logs if a
child process prevents the suite from exiting. To investigate a recurrence, set
repository variables `COMMAND_STREAM_TRACE=true` and `CI_SCRIPTS_DEBUG=true`,
then rerun the affected job. Both traces are off by default. Registry tracing
records status and cache headers without credentials or response bodies.

## Dependency Review Setup

Dependency review requires the repository dependency graph. Enable it under
**Settings → Code security**. Enabling vulnerability alerts also enables the graph:

```bash
gh api --method PUT repos/link-foundation/command-stream/vulnerability-alerts
```

The pull request review fails if the API is unavailable or unauthorized. It never
reports a skipped review as a successful review. Lockfile audits run separately.
