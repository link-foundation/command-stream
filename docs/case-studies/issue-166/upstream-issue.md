# Upstream report — js pipeline template: `version-and-commit.mjs` `git push` is not exit-code checked

> Target repo: `link-foundation/js-ai-driven-development-pipeline-template`
> (and the sibling `python` / `csharp` templates that share the same script).
> Filed from the investigation of `link-foundation/command-stream` issue #166.

## Summary

`scripts/version-and-commit.mjs` pushes the version-bump commit with a bare
`` await $`git push origin main` `` and then unconditionally emits
`version_committed=true`. Because command-stream's `$` does **not** throw on a
non-zero exit (errexit is off by default — see command-stream #156), a failed
push is not observed: the script reports success and the downstream publish /
release job runs against a `main` that never received the commit. This is the
same false-positive class that caused command-stream #166 (where the *publish*
step had the analogous bug).

## Affected code (template, current)

```js
// Push to main
await $`git push origin main`;
console.log('✅ Version bump committed and pushed to main');
setOutput('version_committed', 'true');
```

`$` resolves with `{ code, stdout, stderr }` regardless of exit status, so the
`console.log` and `setOutput('version_committed', 'true')` always run — even
when the push was rejected (non-fast-forward, auth failure, branch protection,
network error).

## Reproduction

```sh
mkdir /tmp/tmpl-push-repro && cd /tmp/tmpl-push-repro
git init -q && git commit -q --allow-empty -m init
# Point origin at a remote the push will be rejected by (no write access / wrong ref):
git remote add origin https://example.invalid/repo.git

cat > repro.mjs <<'EOF'
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
await $`git push origin main`;          // fails, but does NOT throw
console.log('✅ pushed (FALSE POSITIVE)'); // still prints
EOF
bun repro.mjs
# => prints the "✅ pushed (FALSE POSITIVE)" line despite the push failing
```

## Suggested fix

Capture the result and check the exit code (mirrors how the template's
`publish-to-npm.mjs` already handles `npm view`):

```js
const pushResult = await $`git push origin main`.run({ capture: true });
if (pushResult.code !== 0) {
  throw new Error(
    `git push origin main failed (exit code ${pushResult.code}): ` +
    `${pushResult.stderr?.trim() || 'no stderr'}`
  );
}
console.log('✅ Version bump committed and pushed to main');
setOutput('version_committed', 'true');
```

## Workaround for template consumers (until fixed upstream)

Apply the patch above to your local copy of `scripts/version-and-commit.mjs`, or
add `set -o errexit`-style guarding by wrapping git calls with explicit
`.run({ capture: true })` + `code` checks. command-stream #166's PR
(`link-foundation/command-stream#167`) contains the same fix applied to the
repo's drifted copy.

## Notes

- The template's `publish-to-npm.mjs` and `create-github-release.mjs` are
  **already correct** (they scan output / check the result code), so no report
  is needed for those — this report is specifically about `git push` in
  `version-and-commit.mjs`.
- Root cause is structural: any bare `await $`…`` whose result gates a CI output
  is a latent false positive under command-stream's non-throwing `$`. A template
  lint rule (grep for `await $\`git push` / `await $\`gh ` not followed by a
  `.run({ capture` + code check) would catch future regressions.
