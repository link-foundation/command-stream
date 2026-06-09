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
