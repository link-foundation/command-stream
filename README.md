# command-stream

[![JavaScript package](https://img.shields.io/npm/v/command-stream.svg?label=js%20npm)](https://www.npmjs.com/package/command-stream)
[![Rust crate](https://img.shields.io/crates/v/command-stream.svg?label=rust%20crate)](https://crates.io/crates/command-stream)
[![License](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/link-foundation/command-stream?style=social)](https://github.com/link-foundation/command-stream/stargazers)

Command-stream provides stream-oriented shell command execution APIs in two
language implementations:

- [JavaScript package](./js/README.md): Bun and Node.js package published to
  npm as `command-stream`.
- [Rust crate](./rust/README.md): Rust library and binary published to crates.io
  as `command-stream`.

Both implementations focus on shell-like command execution, real-time output
handling, pipeline support, and cross-platform behavior. Language-specific API
examples, package-manager instructions, release notes, and best practices live
with each package.

## Repository Layout

| Path       | Purpose                                                    |
| ---------- | ---------------------------------------------------------- |
| `js/`      | JavaScript package source, tests, docs, and CI/CD scripts. |
| `rust/`    | Rust crate source, tests, docs, and CI/CD scripts.         |
| `docs/`    | Repository-level investigations and case studies.          |
| `.github/` | GitHub workflow definitions and deployment notes.          |

## Releases

JavaScript and Rust releases are independent:

- JavaScript workflow: `.github/workflows/js.yml`
- Rust workflow: `.github/workflows/rust.yml`
- JavaScript GitHub release tags: `js-v<version>`
- Rust GitHub release tags: `rust-v<version>`

## Development

Run language-specific checks from the language folders:

```bash
cd js
bun install
bun run test
bun run check
```

```bash
cd rust
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features
```

## License

Command-stream is released under the [Unlicense](./LICENSE).
