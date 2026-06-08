# Deployment Setup

This repository releases both packages from `.github/workflows/release.yml`:

- npm package: `command-stream`
- Rust crate: `command-stream`

The workflow runs checks on pull requests and publishes on pushes to `main` after
the checks pass.

## Required Publishing Setup

### npm

npm publishing uses trusted publishing through GitHub Actions OIDC. Do not add
or rotate an `NPM_TOKEN` for this workflow.

Configure the trusted publisher in npm for:

- Repository: `link-foundation/command-stream`
- Workflow file: `.github/workflows/release.yml`
- Environment: none, unless the npm package is configured to require one

The workflow updates npm to a trusted-publishing compatible version before
running `changeset publish`.

### crates.io

Rust publishing uses Cargo token authentication. Configure one of these GitHub
Actions secrets at the repository or organization level:

- `CARGO_REGISTRY_TOKEN` - Cargo's native environment variable name, preferred
- `CARGO_TOKEN` - backwards-compatible fallback used by older organization
  workflows

The release workflow maps both names:

```yaml
CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
CARGO_TOKEN: ${{ secrets.CARGO_TOKEN }}
```

The crates publisher first checks whether the current `rust/Cargo.toml` version
already exists on crates.io. If it exists, the step reports success and does not
require a token. If it is missing, the step requires a token and runs
`cargo publish`.

## Pull Request Checks

Pull requests must add exactly one changeset file in `.changeset/`. CI then runs:

- changeset validation
- ESLint, Prettier, and duplication checks
- Bun tests on Ubuntu, macOS, and Windows
- Node.js module loading checks on Node 20, 22, and 24
- Rust formatting, Clippy, tests, doc tests, and `cargo package`

Command-stream trace output is off by default in CI. Set the repository variable
`COMMAND_STREAM_TRACE=true` only when a diagnostic rerun needs full tracing.

## Release Flow

On push to `main`:

1. CI verifies JavaScript and Rust checks.
2. Changesets bump the npm package version, update changelog files, and sync
   `rust/Cargo.toml` plus `rust/Cargo.lock` to the same version.
3. The workflow publishes the npm package with trusted publishing.
4. The workflow publishes `rust/Cargo.toml` to crates.io if that crate version is
   not already published.
5. The workflow creates and formats the GitHub release.

Manual instant releases use the same publishing steps through
`workflow_dispatch`.

## Manual Publishing

Use manual publishing only for emergency recovery:

```bash
# npm, after logging in locally
npm publish --access public

# crates.io, after logging in locally
cargo publish --manifest-path rust/Cargo.toml
```

Prefer rerunning the GitHub Actions release workflow so npm, crates.io, and the
GitHub release stay aligned.

## Troubleshooting

- Missing changeset: add one `.changeset/*.md` file to the PR.
- npm trusted publishing failure: verify npm trusted publisher settings match
  `.github/workflows/release.yml`.
- crates.io authentication failure: verify `CARGO_REGISTRY_TOKEN` or
  `CARGO_TOKEN` is available to Actions.
- crate version already exists: bump `rust/Cargo.toml` before trying to publish
  new Rust crate contents, or rerun the normal release flow so
  `scripts/sync-rust-version.mjs` syncs Cargo metadata from `package.json`.
- tests are too noisy: leave `COMMAND_STREAM_TRACE` unset or set it to `false`.
