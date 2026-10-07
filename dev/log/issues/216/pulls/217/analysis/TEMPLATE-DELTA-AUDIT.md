# Issue 216: template delta audit (command-stream)

Compare ranges audited (read-only, templates treated as text):

- JS template 4c8644fb..1e43fdb4 (PR #213, fixes #205-#212)
- Rust template e7d4a5bc..d74660b0 (PR #189, issues #177-#188)
- Python template 1e2f475c..1e929ef8 (PR #97, fixes #93)

Repo paths below are relative to /tmp/gh-issue-solver-1791351540324.

## Summary table

| # | Theme (template source) | Defect / template change | command-stream status (file:line) | Verdict |
|---|---|---|---|---|
| J1 | PR manifest/changeset vs merge base (js scripts/pr-comparison.mjs:12-37, check-version.mjs:14-33, validate-changeset.mjs:29-103) | Compare against merge base, added-only fragments, semantic version compare, frontmatter-anchored bump parse | js/scripts/check-version.mjs:6-33 and js/scripts/validate-changeset.mjs:24-65 already use merge base + `A` filter; js.yml:94-102 passes SHAs. Gaps: no `--no-renames`/`-z` (validate-changeset.mjs:43), bump regex `^'command-stream':`/m not anchored to frontmatter (validate-changeset.mjs:77-81) | ALREADY-COVERED (optional SMALL hardening) |
| J2 | npm OIDC exchange preflight (js scripts/preflight-credentials.sh check_npm_oidc) | Verify the package token exchange before release, fail in release mode | .github/scripts/publish-preflight.mjs:17-48 (POST /-/npm/v1/oidc/token/exchange/package/<name>, throws on non-OK) | ALREADY-COVERED |
| J3a | npm badge detection (format-release-notes-helpers.mjs hasGeneratedNpmBadge) | Exact badge match to avoid duplicates/misses | js/scripts/release-note-badge.mjs:1-16, used at js/scripts/format-release-notes.mjs:87-91 | ALREADY-COVERED |
| J3b | Release commit message via argv (version-and-commit.mjs) | Avoid shell quoting of commit message | js/scripts/release-git.mjs:5-7 (execFileSync argv), test js/tests/release-git.test.mjs:15-30 | ALREADY-COVERED |
| J3c | run-with-budget-warning.sh awk `\\n` | Literal `\n` in diagnostics | No such script | NOT-APPLICABLE |
| J4 | Recover missing GitHub release (check-release-needed.mjs + new github-release-state.mjs; release.yml gives GITHUB_TOKEN) | If npm has the version but tag release is 404, release with skip_bump; lookup errors = unknown, no release | js/scripts/check-release-needed.mjs:112-117 returns should_release=false whenever npm has the version; never checks GitHub. Publish step js.yml:459-462 and release step js.yml:467-475 never re-run, so a failed/cancelled `Create JavaScript GitHub Release` leaves js-v<ver> missing forever (false negative). publish-to-npm.mjs:227-235 already emits published=true for already-published versions, so re-entering the publish path is safe. Rust side covered by rust/scripts/check-release-needed.rs:168-192, 320-392 (but treats lookup errors as missing, lines 188-191/331) | APPLICABLE-SMALL (JS); Rust COVERED (minor: error != missing) |
| J5/R5 | Scope CodeQL (.github/codeql/codeql-config.yml paths-ignore experiments/examples; `config-file:` in init) | Alerts in non-shipped code drown real ones | .github/workflows/security.yml:58-65 has build-mode none, no config-file; no .github/codeql/. 26 open alerts: 15 in js/examples, 5 in docs/case-studies template snapshots, 4 in js/tests, 1 js/src/bun-shell/subprocess.mjs:433, 1 claude-profiles.mjs:205 | APPLICABLE-SMALL |
| J6a | Pin runners (`ubuntu-latest` -> `ubuntu-24.04`) | Runner image drift | All pinned (js.yml:192,343; rust.yml:183; bun-shell.yml:42); no `-latest` | ALREADY-COVERED |
| J6b | Pin secretlint | Tool drift | security.yml:249-254 pins 13.0.7 | ALREADY-COVERED |
| J6c | Pin zizmor version, reproduce comment matches CI | Unpinned zizmor = new audits fail CI unexpectedly; doc says medium while CI uses low | .github/workflows/workflows.yml:88 zizmor-action@v0.6.4 with no `version:`; comment at workflows.yml:83-84 says unpinned `pipx run zizmor ... --min-confidence medium` | APPLICABLE-SMALL |
| J6d | check-ci-workflows.mjs policy guard | Enforce pins in a test | js/tests/workflow-hygiene.test.mjs exists; extending it is optional | APPLICABLE-LARGE (optional) |
| J6e | (not in delta, same lesson) `bun-version` pin, template uses `'1.x'` | Floating `latest` crosses a future Bun 2.0 major | `bun-version: latest` in ~14 places (js.yml:88,142,225,415,532,608; security.yml:165; quality.yml:56,94,126; parity.yml:54; docs.yml:55; dependencies.yml:39; benchmarks.yml:80; bun-shell.yml:63) | APPLICABLE-SMALL (optional) |
| J7 | CRLF-tolerant commit-message test (tests/commit-message.test.js) | Windows checkout CRLF breaks source-text regex | Our test runs a real git commit, not source matching; Windows matrix green | NOT-APPLICABLE (lesson: use `\r?\n` in source-matching tests) |
| R177 | cargo publish `--token` leaks in argv | Use CARGO_REGISTRY_TOKEN env | rust/scripts/publish-crate.rs:42-50 env, tested ~374-382 | ALREADY-COVERED |
| R178/179 | rust-script per job + version pin (install-rust-script.sh: exact version, --force) | Missing tool / drift | Every rust.yml job installs `rust-script --version 0.36.0 --locked` (rust.yml:85,268,397,476,531) | ALREADY-COVERED |
| R180 | Runner labels | Drift | Pinned | ALREADY-COVERED |
| R181 | Cargo manifest warnings fatal (scripts/check-cargo-warnings.sh, simulate-fresh-merge.sh) | RUSTFLAGS=-Dwarnings does not cover Cargo's own warnings (unused manifest key, duplicate target) -> exit 0 | rust.yml:58-59 sets RUSTFLAGS/RUSTDOCFLAGS only; clippy -D warnings. No Cargo-warning gate | APPLICABLE-SMALL |
| R182 | Version/fragment guard vs merge base; fragment must be top-level `<root>/changelog.d/*.md`, added-only, `-z` | Fragment in wrong dir / modified-only passes check but is never released | rust/scripts/check-version-modification.rs COVERED. rust/scripts/check-changelog-fragment.rs:107-117 accepts any `.md` under rust/changelog.d/ including subdirs AND root `changelog.d/` (line 114); collectors only read top-level rust/changelog.d (collect-changelog.rs:106-118, get-bump-type.rs:109-123). Also counts modified (not only added) files. get-bump-type.rs:90-106 silently defaults on an invalid `bump:` value | APPLICABLE-SMALL |
| R183 | crates.io token preflight | Release fails late | .github/scripts/publish-preflight.mjs:50-94 (PUT /crates/new expects 400 invalid tarball length) | ALREADY-COVERED |
| R184 | Release commit index isolation (allowlist) | Stray files committed in release | rust/scripts/release-git.rs:18-87, js/scripts/release-git.mjs:9-49 | ALREADY-COVERED |
| R185 | Run doc tests once | `cargo test` already runs doctests; separate `--doc` step doubles time | .github/workflows/rust.yml:217-223 runs `cargo test --all-features` then `cargo test --doc --all-features` | APPLICABLE-SMALL |
| R186 | zizmor low confidence, no `${{ }}` in run:, secretlint pins | Hidden artipacked / injection | min-confidence low already; scan found no `${{ }}` inside run: blocks | ALREADY-COVERED (except J6c pin) |
| R187a | lychee per-host throttle (lychee.toml `[hosts."github.com"] concurrency=2, request_interval="1s"`), retry 5xx/429 | Scheduled false failures from github.com 429/503 | links.yml is schedule/dispatch only, non-blocking, has GITHUB_TOKEN, `--max-retries 2`. Run 36423160771 failed with a 503 on github.com blob (transient) plus a real 404 on link-foundation.github.io/command-stream/ | APPLICABLE-SMALL (optional, low priority); the 404 is a real broken link to fix separately |
| R187b | crates wait 40x15s (wait-for-crate.rs) | Index lag > 5 min fails release | rust/scripts/wait-for-crate.rs:14,127-128 defaults 30x10s | APPLICABLE-SMALL (optional; check job timeout) |
| R188 | dtolnay/rust-toolchain pinned to a SHA in master history | Pin to an orphan SHA | Already pinned 7e38f4b43b4db5c8dd498af069a4f6196df1d067 | ALREADY-COVERED |
| P93 | Python fragments: merge base, added-only, top-level, content validation | Same as R182 | JS covered (J1); Rust gap is R182 | see R182 |

Side note: "JavaScript checks and release" has failed on main at 1fc9e3a and a171ef3. This is likely issue 216's own subject (changeset version formatting) and is out of scope for this delta audit.

## APPLICABLE-SMALL diffs

### 1. JS: recover a missing GitHub release (J4)

js/scripts/check-release-needed.mjs, replace the `if (isPublished) {...}` branch (lines 112-117):

```js
    if (isPublished) {
      const tag = `js-v${currentVersion}`;
      const state = await githubReleaseState(tag); // 'present' | 'missing' | 'unknown'
      console.log(`GitHub release ${tag}: ${state}`);
      setOutput('github_release_missing', state === 'missing' ? 'true' : 'false');
      setOutput('should_release', state === 'missing' ? 'true' : 'false');
      setOutput('skip_bump', state === 'missing' ? 'true' : 'false');
      return;
    }
```

```js
async function githubReleaseState(tag) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return 'unknown';
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  try {
    const res = await fetch(`${api}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return 'missing';
    return res.ok ? 'present' : 'unknown';
  } catch {
    return 'unknown';
  }
}
```

.github/workflows/js.yml:

```diff
       - name: Check if release is needed
         id: check_release
         working-directory: js
         env:
           HAS_CHANGESETS: ${{ steps.check_changesets.outputs.has_changesets }}
+          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
         run: bun scripts/check-release-needed.mjs
 ...
         if: >-
           steps.version.outputs.version_committed == 'true' ||
           steps.version.outputs.already_released == 'true' ||
-          steps.check_release.outputs.current_unpublished == 'true'
+          steps.check_release.outputs.current_unpublished == 'true' ||
+          steps.check_release.outputs.github_release_missing == 'true'
```

(publish-to-npm.mjs:227-235 already emits published=true for an already-published version, so the release and notes steps run.) Optional for Rust: in rust/scripts/check-release-needed.rs:188-191/331, treat non-404 lookup errors as unknown, not missing.

### 2. CodeQL scope (J5)

New .github/codeql/codeql-config.yml:

```yaml
name: Shipped code and pipeline scripts
paths-ignore:
  - experiments
  - js/experiments
  - js/examples
  - docs/case-studies
  - dev/log
```

.github/workflows/security.yml:59-65:

```diff
           build-mode: none
+          config-file: ./.github/codeql/codeql-config.yml
```

Check before merging: js/examples is user-facing documentation code. Excluding it drops 15 alerts. If those examples are meant to be copied by users, fix them instead.

### 3. zizmor pin (J6c)

.github/workflows/workflows.yml:

```diff
-      #   pipx run zizmor --config .github/zizmor.yml \
-      #     --min-confidence medium --persona regular .github/workflows
+      #   pipx run zizmor==1.30.1 --config .github/zizmor.yml \
+      #     --min-confidence low --persona regular .github/workflows
 ...
       - uses: zizmorcore/zizmor-action@v0.6.4
         with:
+          version: 1.30.1
           advanced-security: false
```

(Use the zizmor version currently bundled as the v0.6.4 default. Confirm it before pinning.)

### 4. Rust fragment must be top-level and added (R182 / P93)

rust/scripts/check-changelog-fragment.rs:107-117:

```diff
-    (file_path.starts_with(&changelog_dir) || file_path.starts_with("changelog.d/"))
-        && file_path.ends_with(".md")
-        && !file_path.ends_with("README.md")
+    file_path
+        .strip_prefix(changelog_dir.as_str())
+        .is_some_and(|name| !name.contains('/') && name.ends_with(".md") && name != "README.md")
```

Also count fragments using `git diff --name-only -z --diff-filter=A origin/$BASE...HEAD`, split on `\0`. Optionally reject a fragment whose `bump:` value is not patch/minor/major, or whose body is empty. Today get-bump-type.rs:90-106 silently falls back to the default.

### 5. Remove duplicate doc tests (R185)

.github/workflows/rust.yml:221-223:

```diff
-      - name: Run doc tests
-        working-directory: rust
-        run: cargo test --doc --all-features --verbose
```

### 6. Cargo warnings gate (R181)

Add to the rust.yml lint job (after fmt, before clippy):

```yaml
      - name: Deny Cargo warnings
        working-directory: rust
        run: |
          set -o pipefail
          cargo check --locked --all-targets --all-features --color never 2>&1 | tee "$RUNNER_TEMP/cargo.log"
          if grep -E '^warning(:|\[)' "$RUNNER_TEMP/cargo.log"; then
            echo "::error::Cargo reported warnings" >&2; exit 1
          fi
```

### Optional small items

- validate-changeset.mjs:43: add `--no-renames` (and `-z`). validate-changeset.mjs:77-81: match the bump only inside `/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/`.
- `bun-version: latest` -> `'1.x'` in the ~14 places listed in J6e.
- rust/scripts/wait-for-crate.rs:14,127-128: change the defaults from 30/10 to 40/15.
- links.yml: add a lychee.toml with `[hosts."github.com"] concurrency = 2` / `request_interval = "1s"`, or add `--retry-wait-time`. Separately fix the real 404 on https://link-foundation.github.io/command-stream/.
