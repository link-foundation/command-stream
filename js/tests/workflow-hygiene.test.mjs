// Guards the CI/CD invariants fixed for issue #199. actionlint and zizmor run in
// .github/workflows/workflows.yml and cover syntax and security, but neither one
// knows about the repository-specific rules below: how concurrency has to be
// shaped so a release is never cancelled mid-publish, that `always()` must not
// be used where `!cancelled()` is meant, and that matrix job names must stay
// distinguishable.
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = join(repoRoot, '.github', 'workflows');

const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflows = workflowFiles.map((name) => {
  const text = readFileSync(join(workflowDir, name), 'utf8');
  return { name, text, doc: Bun.YAML.parse(text) };
});

/**
 * Jobs that mutate the repository: push a commit or a tag to main, publish a
 * package, or open a release pull request. These are the ones that must never
 * be cancelled halfway.
 *
 * `contents: write` is the test, not `pull-requests: write`. A job can hold the
 * latter alone and still change nothing that outlives the run -- the security
 * workflow's dependency-review only uses it to leave a review comment -- and
 * putting such a job in the shared non-cancellable group would serialise every
 * pull request behind main's releases for no benefit.
 */
const isWriterJob = (job) => (job.permissions ?? {})['contents'] === 'write';

const WRITER_GROUP = 'main-writer-${{ github.repository }}-main';

describe('workflow files', () => {
  test('at least the four known workflows are present', () => {
    expect(workflowFiles).toContain('js.yml');
    expect(workflowFiles).toContain('rust.yml');
    expect(workflowFiles).toContain('parity.yml');
    // Added for #199: nothing linted the workflows themselves before, and
    // nothing audited the dependency trees or analysed the sources.
    expect(workflowFiles).toContain('workflows.yml');
    expect(workflowFiles).toContain('security.yml');
  });

  test.each(workflows.map((w) => [w.name, w]))(
    '%s declares a least-privilege top-level permissions block',
    (_name, workflow) => {
      // Without an explicit block the job token keeps whatever the repository
      // default is, which is `write-all` on older repositories.
      expect(workflow.doc.permissions).toEqual({ contents: 'read' });
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s keeps secrets out of the workflow-level env block',
    (_name, workflow) => {
      // A workflow-level `env:` is inherited by every job, so declaring the
      // crates.io token there handed it to `cargo test` and `cargo clippy` on
      // pull requests -- both of which compile and run code from the branch
      // under review, via build.rs, proc macros or the tests themselves.
      // Publishing credentials belong on the jobs that publish.
      for (const [key, value] of Object.entries(workflow.doc.env ?? {})) {
        expect(`${key}: ${String(value).includes('secrets.')}`).toBe(
          `${key}: false`
        );
      }
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s uses !cancelled() rather than always()',
    (_name, workflow) => {
      // `always()` keeps a job running after the run is cancelled, so a
      // cancelled prerequisite still lets its dependents start.
      const conditions = Object.values(workflow.doc.jobs)
        .map((job) => String(job.if ?? ''))
        .filter((cond) => cond.includes('always()'));
      expect(conditions).toEqual([]);
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s has no expression interpolation inside run: blocks',
    (_name, workflow) => {
      // `${{ }}` is pasted into the shell before it runs; an attacker-controlled
      // value (a branch name on a fork PR) becomes shell code. Pass values
      // through `env:` instead.
      const offenders = [];
      for (const [jobId, job] of Object.entries(workflow.doc.jobs)) {
        for (const step of job.steps ?? []) {
          if (typeof step.run === 'string' && step.run.includes('${{')) {
            offenders.push(`${jobId}: ${step.name ?? step.run.slice(0, 40)}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s pins every third-party action to a full commit hash',
    (_name, workflow) => {
      // Matches .github/zizmor.yml: these publishers are trusted at tag
      // granularity, everything else must be hash-pinned.
      const refPinnedOwners = [
        'actions',
        'github',
        'docker',
        'astral-sh',
        'lycheeverse',
        'zizmorcore',
        'changesets',
      ];
      const offenders = [];
      for (const job of Object.values(workflow.doc.jobs)) {
        for (const step of job.steps ?? []) {
          const uses = step.uses;
          if (typeof uses !== 'string' || uses.startsWith('docker://')) {
            continue;
          }
          const [path, ref] = uses.split('@');
          if (refPinnedOwners.includes(path.split('/')[0])) {
            continue;
          }
          if (!/^[0-9a-f]{40}$/.test(ref ?? '')) {
            offenders.push(uses);
          }
        }
      }
      expect(offenders).toEqual([]);
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s scopes concurrency per job instead of per workflow when it can write',
    (_name, workflow) => {
      const jobs = Object.values(workflow.doc.jobs);
      if (!jobs.some(isWriterJob)) {
        return;
      }
      // A workflow-level cancellable group cancels the whole run, including a
      // release that has already started publishing.
      expect(workflow.doc.concurrency).toBeUndefined();
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s gives every job a concurrency group',
    (_name, workflow) => {
      const missing = Object.entries(workflow.doc.jobs)
        .filter(([, job]) => !job.concurrency?.group)
        .map(([jobId]) => jobId);
      expect(missing).toEqual([]);
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s puts writer jobs in the shared non-cancellable group',
    (_name, workflow) => {
      for (const [jobId, job] of Object.entries(workflow.doc.jobs)) {
        if (!isWriterJob(job)) {
          continue;
        }
        expect(`${jobId}: ${job.concurrency.group}`).toBe(
          `${jobId}: ${WRITER_GROUP}`
        );
        expect(`${jobId}: ${job.concurrency['cancel-in-progress']}`).toBe(
          `${jobId}: false`
        );
      }
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s keeps check jobs cancellable and matrix entries independent',
    (_name, workflow) => {
      for (const [jobId, job] of Object.entries(workflow.doc.jobs)) {
        if (isWriterJob(job)) {
          continue;
        }
        const group = job.concurrency.group;
        expect(`${jobId}: ${group.startsWith('check-')}`).toBe(
          `${jobId}: true`
        );
        expect(`${jobId}: ${job.concurrency['cancel-in-progress']}`).toBe(
          `${jobId}: true`
        );
        // Every matrix dimension must appear in the group, otherwise the matrix
        // entries share one group and cancel each other.
        for (const key of Object.keys(job.strategy?.matrix ?? {})) {
          if (key === 'include' || key === 'exclude') {
            continue;
          }
          expect(`${jobId}/${key}: ${group.includes(`matrix.${key}`)}`).toBe(
            `${jobId}/${key}: true`
          );
        }
      }
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s gives every matrix job a name that distinguishes its entries',
    (_name, workflow) => {
      // Three Node entries in js.yml differed only by `node-version`, which was
      // missing from the name, so all three reported as "Test JavaScript (node
      // on ubuntu-latest)" and no branch rule could require a specific one.
      for (const [jobId, job] of Object.entries(workflow.doc.jobs)) {
        const matrix = job.strategy?.matrix;
        if (!matrix) {
          continue;
        }
        const keys = new Set(
          Object.keys(matrix).filter((k) => k !== 'include')
        );
        for (const entry of matrix.include ?? []) {
          Object.keys(entry).forEach((k) => keys.add(k));
        }
        const name = job.name ?? jobId;
        for (const key of keys) {
          expect(`${jobId}/${key}: ${name.includes(`matrix.${key}`)}`).toBe(
            `${jobId}/${key}: true`
          );
        }
      }
    }
  );
});

describe('workflow linting is itself wired into CI', () => {
  const lintWorkflow = workflows.find((w) => w.name === 'workflows.yml');

  test('actionlint runs from the Docker image that bundles shellcheck', () => {
    // A native actionlint binary without shellcheck on PATH skips every `run:`
    // check and still exits 0.
    const uses = Object.values(lintWorkflow.doc.jobs)
      .flatMap((job) => job.steps ?? [])
      .map((step) => step.uses)
      .filter(Boolean);
    expect(uses.some((u) => u.startsWith('docker://rhysd/actionlint:'))).toBe(
      true
    );
  });

  test('zizmor runs with the repository policy and medium confidence', () => {
    const step = Object.values(lintWorkflow.doc.jobs)
      .flatMap((job) => job.steps ?? [])
      .find((s) => (s.uses ?? '').startsWith('zizmorcore/zizmor-action@'));
    expect(step.with.config).toBe('.github/zizmor.yml');
    expect(String(step.with['min-confidence'])).toBe('medium');
    // The action's default input is `.`, which walks the whole tree and picks up
    // docs/case-studies/**/templates/**: verbatim archived copies of other
    // repositories' workflows, kept as evidence. Auditing those reported 30
    // findings in files that never run here and that a fix would falsify.
    expect(step.with.inputs).toBe('.github/workflows');
  });

  test('the zizmor policy requires hash pins by default', () => {
    const policy = Bun.YAML.parse(
      readFileSync(join(repoRoot, '.github', 'zizmor.yml'), 'utf8')
    );
    expect(policy.rules['unpinned-uses'].config.policies['*']).toBe('hash-pin');
  });

  test('the lint workflow triggers on changes to .github', () => {
    const paths = lintWorkflow.doc.on.pull_request.paths;
    expect(paths.some((p) => p.startsWith('.github'))).toBe(true);
  });

  test('every workflow file is covered by these checks', () => {
    expect(workflows.map((w) => basename(w.name)).length).toBe(
      workflowFiles.length
    );
    expect(workflowFiles.length).toBeGreaterThanOrEqual(4);
  });
});

describe('every shipped ecosystem is audited', () => {
  const security = workflows.find((w) => w.name === 'security.yml');
  const runs = Object.values(security.doc.jobs)
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.run)
    .filter(Boolean)
    .join('\n');

  test('both JavaScript lockfiles are audited, not just one', () => {
    // package-lock.json and bun.lock resolve transitive versions
    // independently, so one can be clean while the other is not: they differed
    // by 8 high-severity advisories when this workflow was written.
    expect(runs).toContain('npm audit --package-lock-only --audit-level=high');
    expect(runs).toContain('bun audit --audit-level=high');
  });

  test('the Rust lockfile is audited', () => {
    expect(runs).toContain('cargo audit --file Cargo.lock');
  });

  test('CodeQL covers both languages and the workflows', () => {
    const languages = security.doc.jobs.codeql.strategy.matrix.language;
    expect(languages).toContain('javascript-typescript');
    expect(languages).toContain('rust');
    expect(languages).toContain('actions');
  });

  test('the working tree is scanned for committed credentials', () => {
    // Nothing looked for credentials in the tree: CodeQL does not, and the
    // audit jobs only read lockfiles (issue #199, best practice #11).
    expect(runs).toContain('secretlint');
    const policy = JSON.parse(
      readFileSync(join(repoRoot, '.secretlintrc.json'), 'utf8')
    );
    expect(policy.rules.map((rule) => rule.id)).toContain(
      '@secretlint/secretlint-rule-preset-recommend'
    );
    // The ignore list may exclude generated trees, never authored source.
    const ignored = readFileSync(join(repoRoot, '.secretlintignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    for (const pattern of ignored) {
      expect(
        `${pattern}: ${/^(node_modules|rust\/target|js\/(reports|coverage))\//.test(pattern)}`
      ).toBe(`${pattern}: true`);
    }
  });

  test('the security workflow is not narrowed by a paths filter', () => {
    // js.yml and rust.yml only run for their own language's files. The audits
    // and the secret scan have to see every change, so this workflow must stay
    // unfiltered -- a `paths:` here would let a credential in, say, a case
    // study reach main unscanned.
    expect(security.doc.on.pull_request?.paths).toBeUndefined();
  });

  test('the audits also run on a schedule', () => {
    // A new advisory lands against code that has not changed, so the
    // push/pull_request triggers alone would leave it unreported until the
    // next commit.
    expect(security.doc.on.schedule?.length).toBeGreaterThan(0);
  });
});

describe('the shipped quality gates are actually invoked', () => {
  const rust = workflows.find((w) => w.name === 'rust.yml');
  const rustRuns = Object.values(rust.doc.jobs)
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.run)
    .filter(Boolean)
    .join('\n');

  // rust/scripts/ shipped four `check-*.rs` guards, but only the changelog one
  // was ever executed: the other three were referenced by no workflow, no
  // script and no document (issue #199). A gate nobody runs is a silent false
  // negative -- the pipeline reports "all checks passed" while the check does
  // not exist.
  test.each([
    ['check-changelog-fragment.rs'],
    ['check-version-modification.rs'],
    ['check-file-size.rs'],
    ['check-crate-size.rs'],
  ])('rust.yml runs %s', (script) => {
    expect(rustRuns).toContain(`rust-script rust/scripts/${script}`);
  });

  test('every rust/scripts entry is invoked or a documented exception', () => {
    // Standalone entry points that this repository deliberately does not wire
    // up. They come from the Rust pipeline template, where separate workflow
    // steps call them; here the same work happens elsewhere.
    const unwired = new Map([
      // version-and-commit.rs does its own bumping (`Version::bump`) and its
      // own fragment collection (`collect_changelog`), so these two standalone
      // entry points would be a second implementation of the same steps.
      ['bump-version.rs', 'version-and-commit.rs does both steps itself'],
      ['collect-changelog.rs', 'version-and-commit.rs does both steps itself'],
      // The workflows select what runs with `on: paths:` filters instead of
      // computing a change matrix in a first job.
      ['detect-code-changes.rs', 'replaced by on: paths: filters'],
      // The release jobs set the bot identity inline, next to the commit they
      // are about to make.
      ['git-config.rs', 'release jobs configure git inline'],
    ]);

    const scriptDir = join(repoRoot, 'rust', 'scripts');
    const scripts = readdirSync(scriptDir).filter((n) => n.endsWith('.rs'));
    const sources = scripts.map((n) =>
      readFileSync(join(scriptDir, n), 'utf8')
    );
    const workflowText = workflows.map((w) => w.text).join('\n');

    for (const script of scripts) {
      const referenced =
        workflowText.includes(script) ||
        sources.some(
          (text, i) => scripts[i] !== script && text.includes(script)
        );
      expect(`${script}: ${referenced || unwired.has(script)}`).toBe(
        `${script}: true`
      );
    }
  });

  test('both languages enforce a maximum file length', () => {
    // Principle #2 of the hive-mind CI/CD best practices. JavaScript gets this
    // from eslint; Rust had the script but no caller.
    const eslint = readFileSync(
      join(repoRoot, 'js', 'eslint.config.js'),
      'utf8'
    );
    expect(eslint).toContain("'max-lines': ['error', 1500]");
    expect(rustRuns).toContain('rust-script rust/scripts/check-file-size.rs');
  });
});

describe('checks validate the merge result, not a stale preview', () => {
  const simulation = '.github/scripts/simulate-fresh-merge.sh';

  // Best practice #7. A pull-request run checks out refs/pull/N/merge, computed
  // when the pull request was last synchronised; if main moved since, the checks
  // pass on a combination that will not exist after the merge.
  test.each([
    ['js.yml', 'lint'],
    ['js.yml', 'test'],
    ['rust.yml', 'lint'],
    ['rust.yml', 'test'],
    ['rust.yml', 'scripts'],
  ])(
    '%s / %s merges the base branch before it checks anything',
    (file, jobId) => {
      const steps = workflows.find((w) => w.name === file).doc.jobs[jobId]
        .steps;
      const index = steps.findIndex((step) =>
        (step.run ?? '').includes(simulation)
      );
      expect(`${file}/${jobId}: ${index !== -1}`).toBe(
        `${file}/${jobId}: true`
      );
      // Everything that inspects the tree has to come after the merge.
      const checkout = steps.findIndex((step) =>
        (step.uses ?? '').startsWith('actions/checkout@')
      );
      expect(checkout).toBeLessThan(index);
      expect(index).toBeLessThan(steps.length - 1);
    }
  );

  test.each(workflows.map((w) => [w.name, w]))(
    '%s only simulates a merge where it can work',
    (_name, workflow) => {
      for (const [jobId, job] of Object.entries(workflow.doc.jobs)) {
        const steps = job.steps ?? [];
        if (!steps.some((step) => (step.run ?? '').includes(simulation))) {
          continue;
        }
        const step = steps.find((s) => (s.run ?? '').includes(simulation));
        // `github.base_ref` is empty outside a pull request, and the merge
        // needs history a shallow checkout does not have.
        expect(`${jobId}: ${step.if}`).toBe(
          `${jobId}: github.event_name == 'pull_request'`
        );
        const checkout = steps.find((s) =>
          (s.uses ?? '').startsWith('actions/checkout@')
        );
        expect(`${jobId}: ${checkout.with['fetch-depth']}`).toBe(`${jobId}: 0`);
      }
    }
  );
});
