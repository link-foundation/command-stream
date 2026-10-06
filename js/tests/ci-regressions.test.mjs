import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = (name) =>
  Bun.YAML.parse(
    readFileSync(
      resolve(import.meta.dir, `../../.github/workflows/${name}.yml`),
      'utf8'
    )
  );

test('issue #209: dependency review cannot turn an unavailable API into success', () => {
  const steps = workflow('security').jobs['dependency-review'].steps;
  const review = steps.find((step) =>
    step.uses?.startsWith('actions/dependency-review-action@')
  );
  expect(review.if).toBeUndefined();
  expect(steps.some((step) => step.run?.includes('enabled=false'))).toBe(false);
});

for (const language of ['js', 'rust']) {
  test(`issue #209: manual ${language} releases require successful checks on main`, () => {
    const jobs = workflow(language).jobs;
    expect(jobs.lint.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(jobs.test.needs).toContain('lint');
    expect(jobs.test.if).toContain("needs.lint.result == 'success'");
    const release = jobs['instant-release'];
    expect(release.needs).toContain('lint');
    expect(release.needs).toContain('test');
    expect(release.if).toContain("github.ref == 'refs/heads/main'");
    expect(release.if).toContain("needs.lint.result == 'success'");
    expect(release.if).toContain("needs.test.result == 'success'");
  });
}

test('issue #209: a parity exemption only exempts paired changes, not executable checks', () => {
  const job = workflow('parity').jobs.parity;
  expect(job.if ?? '').not.toContain('parity-exempt');
  const paired = job.steps.find(
    (step) => step.name === 'Check JavaScript/Rust implementation parity'
  );
  expect(paired.if).toContain('parity-exempt');
  const merge = job.steps.findIndex((step) =>
    step.run?.includes('simulate-fresh-merge.sh')
  );
  const execute = job.steps.findIndex((step) =>
    step.run?.includes('scripts/check-parity.mjs')
  );
  expect(merge).toBeGreaterThan(-1);
  expect(merge).toBeLessThan(execute);
});

test('issue #209: source changes trigger both language benchmark checks', () => {
  for (const event of ['push', 'pull_request']) {
    expect(workflow('benchmarks').on[event].paths).toContain('js/src/**');
    expect(workflow('benchmarks').on[event].paths).toContain('rust/src/**');
  }
});

test('issue #209: Pages configuration fails before dependency installation', () => {
  const job = workflow('docs').jobs.deploy;
  expect(job.if).toContain("github.ref == 'refs/heads/main'");
  const configure = job.steps.findIndex((step) =>
    step.uses?.startsWith('actions/configure-pages@')
  );
  const install = job.steps.findIndex((step) =>
    step.run?.includes('bun install')
  );
  expect(configure).toBeLessThan(install);
});
