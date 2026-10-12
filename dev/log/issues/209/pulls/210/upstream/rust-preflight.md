The pinned template `e7d4a5bceb152f76d9fde77bae6751b835b9cdcd162` sends `Authorization: <Cargo API token>` to `/api/v1/me` in `scripts/preflight-credentials.sh` and treats 403 as an invalid/expired token.

The current [crates.io handler](https://github.com/rust-lang/crates.io/blob/main/src/controllers/user/me.rs) uses `AuthCheck::only_cookie()`. Cargo API tokens cannot pass this route. [Auth scope tests](https://github.com/rust-lang/crates.io/blob/main/src/auth.rs) also show generic account endpoints reject scoped publish tokens. This is a false rejection independent of token validity.

Reproduction using a token that can publish the configured crate:

```bash
curl -sS -H "Authorization: $CARGO_REGISTRY_TOKEN" https://crates.io/api/v1/me
# Cookie-only authentication rejects this request.
```

Workaround: avoid account-profile endpoints for Cargo token verification. Nonempty-token checks alone do not prove publishing access.

Suggested fix: use the actual [publish handler](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/publish.rs) with valid length-prefixed JSON metadata and deliberately omit both tarball length and tarball bytes. It checks endpoint/crate scopes and verified email before reading the archive. Only HTTP 400 with the exact `invalid tarball length` response proves the probe reached that stage. It cannot publish a crate because it contains no archive. Reject every other response as denied/unknown; never log token values. This still does not prove ownership, which the real publish checks later, including team ownership.

[Implementation](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/.github/scripts/publish-preflight.mjs), [mocked denied/error/structural tests](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/js/tests/publish-preflight.test.mjs). The source trace and captured handlers are archived in PR 210; release credentials were not available locally, so a successful live authenticated probe is not claimed.
