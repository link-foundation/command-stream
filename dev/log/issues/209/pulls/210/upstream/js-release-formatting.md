Observed while reviewing command-stream issue 209 / PR 210, against template revision `4c8644fb457b65933fcb19b033e60e7d0338f2ad404`.

`scripts/format-release-notes.mjs:102` treats any mention of `img.shields.io` as proof that notes already contain the generated npm badge. A changelog saying “Fix img.shields.io URL handling”, an image hosted at `img.shields.io.attacker.invalid`, or an unrelated build badge makes the formatter exit successfully without formatting the release. CodeQL also identifies this substring check. This reproduction demonstrates an incorrect skip; it does not claim that the formatter performs an unsafe redirect.

Offline reproduction:

```js
import assert from 'node:assert/strict';
const body = '### Patch Changes\n- Fix img.shields.io URL handling';
const alreadyFormatted = body.includes('img.shields.io');
assert.equal(alreadyFormatted, false); // fails: formatter skips ordinary notes
```

Workaround: remove that substring from unformatted notes or explicitly run formatting without the current skip check. Avoid using a hostname mention as a formatting marker.

Suggested fix: extract Markdown image destinations, parse them with `new URL`, and require an HTTPS image whose hostname is exactly `img.shields.io` and whose pathname starts with `/badge/npm-`. Keep tests for actual generated badges, mentions, hostname suffixes, URL userinfo, path-embedded hostnames, and unrelated badges.

Related review finding: `scripts/version-and-commit.mjs:271–272` manually escapes double quotes before passing the message to command-stream's already quoting interpolation. With the current library this preserves extra backslashes in a message containing quotes. CodeQL reports incomplete escaping. Prefer `execFileSync('git', ['commit', '-m', version])` or the library's ordinary unquoted interpolation, with a real temporary-repository test asserting the exact committed message. No shell command should be constructed by manually escaping a subset of characters.

Reproductions and before/after logs: https://github.com/link-foundation/command-stream/pull/210, under `dev/log/issues/209/pulls/210/validation/codeql-regressions-before.log.gz` and `codeql-regressions-after.log.gz`.
