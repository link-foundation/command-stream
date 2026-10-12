`actions/checkout` leaves the job token in `.git/config` unless it is told not
to. In this template 25 of the 27 checkouts leave it there, and the workflow
that is supposed to catch exactly that cannot report it.

## The blind spot

`.github/workflows/workflows.yml` runs:

```yaml
      - uses: zizmorcore/zizmor-action@v0.6.2
        with:
          advanced-security: false
          annotations: true
          config: .github/zizmor.yml
          min-confidence: medium
```

zizmor's `artipacked` audit reports at **Low** confidence, so
`min-confidence: medium` filters every instance out. Run against this
repository's own workflows with its own config:

```console
$ zizmor --config .github/zizmor.yml --min-confidence medium .github/workflows
58 findings (33 ignored, 22 suppressed, 3 safe fixes): 0 informational, 3 low, 0 medium, 0 high

$ zizmor --config .github/zizmor.yml --min-confidence low .github/workflows
58 findings (1 ignored, 22 suppressed, 3 safe fixes, 32 unsafe fixes): 7 informational, 28 low, 0 medium, 0 high

$ zizmor --config .github/zizmor.yml --min-confidence low .github/workflows | grep -c 'help\[artipacked\]'
25
```

(zizmor 1.30.0. The three findings still visible at `medium` are the
`self-repository` ones from #155.)

Sample:

```
help[artipacked]: credential persistence through GitHub Actions artifacts
  --> .github/workflows/links.yml:43:9
   |
43 |       - uses: actions/checkout@v6
   |         ^^^^^^^^^^^^^^^^^^^^^^^^^ does not set persist-credentials: false
   |
   = note: audit confidence → Low
   = note: this finding has an auto-fix
```

## Where

Every checkout except the two in `workflows.yml`:

| Workflow          | Jobs                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release.yml`     | `detect-changes`, `test-compilation`, `check-file-line-limits`, `version-check`, `changeset-check`, `lint`, `test`, `docker-build`, `validate-docs`, `docker-publish-config`, `docker-publish-build`, `docker-publish`, `pipeline-status` (read-only) and `release`, `instant-release`, `changeset-pr` (`contents: write`) |
| `security.yml`    | `codeql`, `dependency-review`, `npm-audit`                                                                                                                                             |
| `example-app.yml` | `web-build`, `desktop-package`, `android-build`, `ios-build`, `preview-regen`                                                                                                          |
| `links.yml`       | `link-checker`                                                                                                                                                                         |

The Rust template is the counter-example: there, every checkout sets
`persist-credentials: false` except the two jobs that actually push
(`auto-release`, `manual-release` in `release.yml`), which is what a deliberate
decision looks like.

## Why it matters

The read-only jobs are the ones worth fixing first, and `lint` and `test` most
of all: both check out a pull-request branch, run `npm install` on it, and then
run that branch's code. A `postinstall` script or a compromised transitive
dependency can read `.git/config` and use the token for as long as the job runs;
anything that uploads the workspace (or a `.git`-containing subdirectory) as an
artifact publishes it outright. That is the whole point of the `artipacked`
audit, and this repository has switched it off by accident.

## Reproduction

```console
$ git clone https://github.com/link-foundation/js-ai-driven-development-pipeline-template
$ cd js-ai-driven-development-pipeline-template
$ pipx run zizmor==1.30.0 --config .github/zizmor.yml --min-confidence medium .github/workflows   # 0 artipacked
$ pipx run zizmor==1.30.0 --config .github/zizmor.yml --min-confidence low    .github/workflows   # 25 artipacked
```

Or inside a job, without zizmor:

```yaml
      - uses: actions/checkout@v6
      - run: git config --get http.https://github.com/.extraheader   # prints AUTHORIZATION: basic ***
```

## Workaround

Add `persist-credentials: false` to the checkouts by hand; the audit that would
have found the next one stays off.

## Suggested fix

1. Set `persist-credentials: false` on every checkout in a job that does not
   push:

   ```diff
        - uses: actions/checkout@v6
   +      with:
   +        persist-credentials: false
   ```

   `zizmor --config .github/zizmor.yml --min-confidence low --fix=all
   .github/workflows` applies this, but its fixes are `unsafe` here precisely
   because of the three writer jobs — review those three (`release`,
   `instant-release`, `changeset-pr`) and keep their credentials.

2. Then lower the workflow's threshold so a new checkout cannot re-introduce it:

   ```diff
          config: .github/zizmor.yml
   -      min-confidence: medium
   +      min-confidence: low
   ```

   After step 1 that leaves ~10 findings, all in the informational/low bucket
   and each either fixable or suppressible with a `# zizmor: ignore[...]`
   comment that records the reason — which is strictly better than a threshold
   that hides an entire audit.

Found while auditing CI/CD against this template for
link-foundation/command-stream#199.
