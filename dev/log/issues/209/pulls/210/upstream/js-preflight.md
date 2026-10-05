Found against template commit `4c8644fb457b65933fcb19b033e60e7d0338f2ad404` during [command-stream #209](https://github.com/link-foundation/command-stream/issues/209).

`scripts/preflight-credentials.sh` counts `ACTIONS_ID_TOKEN_REQUEST_URL` being set as verified npm publishing access. That variable exists even when the npm trusted-publisher configuration is wrong. A successful unrelated Docker probe can leave the overall preflight green without making any authenticated request to npm.

Offline reproduction with stubbed HTTP (no network, no real credentials):

```bash
python3 experiments/issue-209/probe-template-preflight.py
```

[Probe](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/experiments/issue-209/probe-template-preflight.py), [output](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/dev/log/issues/209/pulls/210/validation/template-preflight-before.log.gz): `2 verified, 0 failed, 0 unknown`, exit 0, and zero npm package exchange requests.

Workaround: perform a package-specific npm exchange before considering the npm target verified; require every configured target to pass independently.

Suggested fix: request GitHub's JWT with audience `npm:registry.npmjs.org`, POST to `/-/npm/v1/oidc/token/exchange/package/<escaped-package>`, reject HTTP/network/malformed responses and discard the returned token without logging it. This is the flow used by [npm CLI](https://github.com/npm/cli/blob/latest/workspaces/libnpmpublish/lib/oidc.js) and [trusted publishing](https://docs.npmjs.com/trusted-publishers/). [Implementation and denied-exchange tests](https://github.com/link-foundation/command-stream/blob/issue-209-4043f0c126d5/.github/scripts/publish-preflight.mjs).
