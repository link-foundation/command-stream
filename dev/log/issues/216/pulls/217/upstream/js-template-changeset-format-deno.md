## Summary

`changeset version` in the release job still fails with `spawn deno ENOENT`, even after the `devEngines.packageManager: npm` fix from #154. On 2026-10-05, run [37294875650](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37294875650) at `4c8644f` failed this way, and `devEngines` was already declared in `package.json` at that commit. The latest `main` run ([37558226002](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/37558226002), `1e43fdb`) does not get as far as `changeset version`, because `release-preflight` fails first (npm OIDC 404). The bug is therefore hidden on `main`, not fixed. Every repository created from this template inherits it. It broke the release of link-foundation/command-stream (issue [#216](https://github.com/link-foundation/command-stream/issues/216), run [37573348181](https://github.com/link-foundation/command-stream/actions/runs/37573348181)).

```
🦋 changeset v3.0.3

Error: spawn deno ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:287:19)
🦋 Exited with code 1
Error during version bump: Command failed with exit code 1
```

## Root cause

Changesets 3 formats the files it writes with `@changesets/format`. When `.changeset/config.json` has no `format` key, the formatter is `"auto"`, and `detect()` in `@changesets/format@0.1.2` resolves it like this:

1. It walks up from the package directory, checking formatters in the order `dprint, deno, oxfmt, biome, prettier`.
2. Deno's config files are `["deno.json", "deno.jsonc", …]`, so **any** `deno.json` selects Deno, even one with no `fmt` key. The template's `deno.json` exists only for `deno test`.
3. The Deno formatter runs `spawnProcess("deno", ["fmt", "--permit-no-files", …])` straight from `PATH`. It does not go through the package manager, so `devEngines.packageManager` has no effect on it.

The release job has no Deno (only the Deno *test* leg runs `setup-deno`), so the spawn fails.

That #154 fix addressed a different lookup: `package-manager-detector`, which is consulted only for formatters that run through `npx`/`bunx` and the like. The formatter selection above happens first and never reaches it.

Upstream confirmed this is intended behaviour and recommended pinning the formatter. On changesets/format#45 the maintainer wrote: *"You should set `"format": "prettier"` in the changeset config in this case. The detection is best effort only."* ([comment](https://github.com/changesets/format/issues/45#issuecomment-5570188298)). PR changesets/format#46 then removed the `{ file: "deno.json", key: "fmt" }` entry entirely, so detection by a bare `deno.json` is now the documented design.

## Reproducible example

This uses only the template's data files and a trusted `@changesets/cli@3.0.3`, with `deno` hidden from `PATH` as it is on the hosted runner:

```bash
git clone --depth 1 https://github.com/link-foundation/js-ai-driven-development-pipeline-template template
work=$(mktemp -d)
cp template/{package.json,package-lock.json,deno.json,deno.lock,.prettierrc} "$work"/
mkdir "$work/.changeset" && cp template/.changeset/config.json "$work/.changeset/"
printf -- '---\n"@link-foundation/example-package-name": patch\n---\n\nCheck.\n' > "$work/.changeset/check.md"
echo '# changelog' > "$work/CHANGELOG.md"
cd "$work" && npm install --no-save --ignore-scripts @changesets/cli@3.0.3 prettier@3
PATH=$(echo "$PATH" | tr ':' '\n' | while read -r d; do [ -x "$d/deno" ] || echo "$d"; done | paste -sd: -) \
  npx changeset version; echo "exit $?"
```

Output at `1e43fdb` (current `main`; `package.json` declares `devEngines.packageManager: npm`):

```
🦋 changeset v3.0.3

Error: spawn deno ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:315:19)
🦋 Exited with code 1

exit 1
```

After adding `"format": "prettier"` to `.changeset/config.json`, the same command prints `All files have been updated` and exits 0.

The full script and logs are in link-foundation/command-stream PR [#217](https://github.com/link-foundation/command-stream/pull/217): `experiments/issue-216/reproduce-template-changeset-version.sh` and `dev/log/issues/216/pulls/217/validation/template-changeset-version-*.log`.

## Workaround

Pin the formatter in `.changeset/config.json`, and update `$schema` to the installed config version:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.1/schema.json",
  "format": "prettier"
}
```

`"format": false` also works, but it leaves the generated `CHANGELOG.md` unformatted, so `format:check` would fail on the version commit.

## Suggested fix

1. Add `"format": "prettier"` to `.changeset/config.json`, as above. Prettier is already a devDependency and is the project's formatter, so the release then formats with the same tool as `format:check`.
2. Add a regression test that runs the real `changeset version` in a temporary copy with `deno` removed from `PATH`. command-stream's version is [`js/tests/changeset-config.test.mjs`](https://github.com/link-foundation/command-stream/blob/issue-216-fe6e9f11097a/js/tests/changeset-config.test.mjs); it fails with exactly `spawn deno ENOENT` before the fix.
3. Close the false negative that let the bug reach `main`: no PR-time job runs `changeset version`, so it fails only after a merge. command-stream now dry-runs it in its lint job after the fresh-merge simulation, and discards the result:

   ```yaml
   - name: Dry-run release versioning
     run: |
       npm run changeset:version
       git status --short
       git checkout -- .
   ```

   The template should also stop `release-preflight` credential failures from hiding versioning failures, for example by running this dry run on PRs, where no credentials are needed.
4. Optionally keep `check-package-manager.mjs`, since the package-manager lookup still matters for `npx prettier`. Its header comment, though, says it fixes `spawn deno ENOENT`, and that should be corrected.
