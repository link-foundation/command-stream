// Documentation is validated in CI like code: principle #12 of the hive-mind
// CI/CD best practices, which nothing in this repository implemented before
// issue #199. Three failure modes are covered here, all of them found in the
// tree when this file was written or fixed in the same commit:
//
//   - a relative link that points at a file which does not exist (a case study
//     linked to two release markers that the release process had consumed, and
//     another one was one directory level off),
//   - a document that has outgrown any reasonable review size,
//   - a key document losing the section a reader is sent to it for.
//
// External links are deliberately out of scope here: a link checker that
// reaches the network turns unrelated pull requests red when a third-party site
// rots, which is the class of false positive issue #199 is about. They are
// fetched weekly instead, by .github/workflows/links.yml, which blocks nothing.
import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve, relative, sep } from 'path';
import { execFileSync } from 'child_process';

const repoRoot = join(dirname(Bun.fileURLToPath(import.meta.url)), '..', '..');

// execFileSync, not execSync: `git ls-files '*.md'` goes through cmd.exe on
// Windows, which does not strip single quotes, so git looked for a file named
// `'*.md'`, matched nothing, and this file validated an empty list -- green on
// Windows because it checked nothing at all (caught by the Windows leg of the
// test matrix). Without a shell, git expands the pattern itself everywhere.
const markdownFiles = execFileSync('git', ['ls-files', '*.md'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

/**
 * Verbatim copies of other repositories' files, kept as evidence and never
 * edited: their links point into the tree they came from, and their size is
 * not this repository's to control.
 */
const isArchived = (file) =>
  file.startsWith('dev/log/') ||
  /docs\/case-studies\/[^/]+\/(templates|data|template-data)\//.test(file);

const authored = markdownFiles.filter((file) => !isArchived(file));

// Best practice #12 suggests 2500 lines for documentation, above the 1500-line
// limit eslint enforces for source. The longest file in the tree is js/README.md.
const MAX_DOC_LINES = 2500;

describe('documentation validation', () => {
  test('the file list is not empty and skips archived copies', () => {
    expect(authored.length).toBeGreaterThan(20);
    expect(authored.some(isArchived)).toBe(false);
  });

  test.each(authored.map((file) => [file]))(
    '%s stays within the documentation line limit',
    (file) => {
      const lines = readFileSync(join(repoRoot, file), 'utf8').split(
        '\n'
      ).length;
      expect(`${file}: ${lines <= MAX_DOC_LINES}`).toBe(`${file}: true`);
    }
  );

  test.each(authored.map((file) => [file]))(
    '%s has no broken relative links',
    (file) => {
      const text = readFileSync(join(repoRoot, file), 'utf8');
      const targets = [
        ...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
      ].map((match) => match[1]);

      const broken = [];
      for (const raw of targets) {
        // Anchors, external schemes and inline data are out of scope.
        if (/^(https?:|mailto:|tel:|data:|#)/.test(raw)) {
          continue;
        }
        const target = decodeURI(raw.split('#')[0]);
        if (!target) {
          continue;
        }
        const absolute = target.startsWith('/')
          ? join(repoRoot, target)
          : resolve(join(repoRoot, dirname(file)), target);
        if (!existsSync(absolute)) {
          broken.push(`${raw} (-> ${relative(repoRoot, absolute) || sep})`);
        }
      }
      expect(`${file}: ${broken.join(', ')}`).toBe(`${file}: `);
    }
  );

  // A reader following a cross-reference lands on a heading. These are the
  // headings other documents and the workflows point at.
  test.each([
    ['README.md', ['## Repository Layout', '## Releases', '## Development']],
    [
      'docs/CI-CD.md',
      ['## Workflows', '## Invariants', '## Required repository settings'],
    ],
    ['js/README.md', ['## Installation', '## API Reference']],
    ['rust/README.md', ['## Installation', '## Library Usage']],
    ['rust/changelog.d/README.md', ['bump:']],
    ['js/.changeset/README.md', ['changeset']],
  ])('%s keeps its required sections', (file, sections) => {
    const text = readFileSync(join(repoRoot, file), 'utf8');
    for (const section of sections) {
      expect(`${file}: ${section}: ${text.includes(section)}`).toBe(
        `${file}: ${section}: true`
      );
    }
  });
});
