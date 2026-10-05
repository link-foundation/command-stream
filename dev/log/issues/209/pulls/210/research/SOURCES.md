# Primary sources researched on 2026-10-05

- npm trusted publisher requirements: https://docs.npmjs.com/trusted-publishers/
- npm CLI actual package-specific OIDC exchange: https://github.com/npm/cli/blob/latest/workspaces/libnpmpublish/lib/oidc.js (`npm-oidc.js` captured locally).
- Cargo publish token environment support: https://doc.rust-lang.org/cargo/commands/cargo-publish.html
- crates.io current cookie-only profile endpoint: https://github.com/rust-lang/crates.io/blob/main/src/controllers/user/me.rs (`crates-me.rs.gz`).
- crates.io scope rules: https://github.com/rust-lang/crates.io/blob/main/src/auth.rs (`crates-auth.rs.gz`).
- crates.io publish authentication/body-read sequence: https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/publish.rs (`crates-publish.rs.gz`).
- GitHub Pages repository bootstrap: https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site
- GitHub vulnerability alerts enablement, including dependency graph: https://docs.github.com/en/rest/repos/repos#enable-vulnerability-alerts
- Changesets fragment/version/publish workflow: https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md
- actionlint official image and shellcheck support: https://github.com/rhysd/actionlint/blob/main/docs/usage.md
- zizmor local workflow audits and config: https://docs.zizmor.sh/usage/
- Secretlint rules/CLI: https://github.com/secretlint/secretlint
- lychee link checker: https://lychee.cli.rs/
- Scriv fragment tooling: https://scriv.readthedocs.io/en/latest/
- Unpatched development-tool braces advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

- CodeQL parsed URL hostname guidance: https://codeql.github.com/codeql-query-help/javascript/js-incomplete-url-substring-sanitization/
- CodeQL context-aware escaping guidance: https://codeql.github.com/codeql-query-help/javascript/js-incomplete-sanitization/
- Bun current broken-pipe expectation: https://github.com/oven-sh/bun/blob/main/test/js/bun/shell/bunshell.test.ts (full source captured as `bun-bunshell-current.txt.gz`, main SHA in `bun-main-sha.txt`).

Run-specific facts are based on the archived GitHub logs and local measurements, not inferred from these documentation pages. Historical npm cache involvement is an inference; the exact original cache state was not captured.

- [Pinned CodeQL diff-limit handling](https://github.com/github/codeql-action/blob/1767808e1164b88b6d037184ffb3ed13697e8966/src/diff-informed-analysis-utils.ts#L156): returns no ranges when the 300-file comparison could be incomplete. Current CI confirms fallback to standard source-root analysis and successful SARIF uploads. Full source copy and search metadata are retained.
