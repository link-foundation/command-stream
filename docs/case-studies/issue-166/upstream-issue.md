# Upstream reports — js pipeline template (from command-stream #166)

> Target repo: `link-foundation/js-ai-driven-development-pipeline-template`
> (and the sibling `python` / `csharp` templates that share the same scripts).
> Filed from the investigation of `link-foundation/command-stream` issue #166.
> Two independent reports follow: (1) `version-and-commit.mjs` `git push` not
> exit-code checked, and (2) `check-release-needed.mjs` self-heal misses the
> "stale local changeset" restart.

---

# Upstream report #1 — js pipeline template: `version-and-commit.mjs` `git push` is not exit-code checked

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
(`link-foundation/command-stream#168`) contains the same fix applied to the
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

---

# Upstream report #2 — js pipeline template: self-heal misses the "stale local changeset" restart

> Target repo: `link-foundation/js-ai-driven-development-pipeline-template`,
> `scripts/check-release-needed.mjs` (template issue #36 introduced the
> self-heal). Filed from command-stream issue #166 (cause #3).

## Summary

`check-release-needed.mjs` self-heals a committed-but-unpublished version by
probing npm — **but only when `has_changesets` is `false`**. If a changeset file
is still present in the checkout while its version bump has *already been
consumed on the remote* (a CI restart, a re-run, or a race), the script takes the
"found changesets, proceed" branch, never probes npm, and the workflow's publish
step — gated on the version step having committed something — is silently
skipped. The bumped version is stranded above npm forever.

## How it happened (command-stream #166 restart)

1. A prior run bumped `0.10.2`, committed it to `main`, and consumed the
   changeset.
2. A restart ([run 27224046292](https://github.com/link-foundation/command-stream/actions/runs/27224046292))
   checked out a tree that *still contained* a changeset file →
   `has_changesets=true`.
3. `changeset version` found `No unreleased changesets found, exiting` → the
   version step committed nothing → `version_committed=false`.
4. Publish was gated off. npm stayed at `0.9.5` while the repo said `0.10.2`.
   Because `has_changesets` was true, the self-heal's npm probe never ran.

## Suggested fix

Probe npm **unconditionally** and emit a dedicated output that the publish step
can gate on, independent of changeset state:

```js
const isPublished = await checkVersionOnNpm(packageName, currentVersion);
setOutput('current_unpublished', isPublished ? 'false' : 'true');
// ...still set should_release/skip_bump as before, but the workflow's publish
// step also runs when current_unpublished == 'true'.
```

and in the workflow:

```yaml
if: steps.version.outputs.version_committed == 'true' ||
    steps.version.outputs.already_released == 'true' ||
    steps.check_release.outputs.current_unpublished == 'true'
```

## Reproduction (logic)

Set `HAS_CHANGESETS=true` and a `package.json` version that is not on npm; the
current template emits `should_release=true`/`skip_bump=false` but **no** signal
that the current version itself is unpublished, so a no-op bump leaves nothing to
publish. command-stream #166's PR adds a regression test
(`js/tests/check-release-needed.test.mjs`) covering exactly this shape.

## Companion guard

Pair this with a post-publish `wait-for-npm` step (`npm view <pkg>@<version>`
polled to a hard failure) so any future "tagged but not installable" divergence
fails CI loudly rather than producing another false-positive release.
