import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function stageReleaseMetadata() {
  const root = git('rev-parse', '--show-toplevel');
  const prefix = git('rev-parse', '--show-prefix');
  const readPaths = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const files = [
    ...new Set([
      ...readPaths(
        'ls-files',
        '--modified',
        '--deleted',
        '--others',
        '--exclude-standard',
        '-z'
      ),
      ...readPaths('diff', '--cached', '--name-only', '-z'),
    ]),
  ];
  const allowed =
    /^(package\.json|package-lock\.json|bun\.lock|CHANGELOG\.md|\.changeset\/[^/]+\.md)$/;
  if (
    files.some(
      (file) =>
        !file.startsWith(prefix) || !allowed.test(file.slice(prefix.length))
    )
  ) {
    throw new Error(
      'Release generated changes outside the package metadata allowlist'
    );
  }
  if (files.length) {
    execFileSync('git', ['-C', root, 'add', '--', ...files]);
  }
}

export function classifyPushFailure(output) {
  const text = output.toLowerCase();
  if (
    /gh006|gh013|repository rule violations|changes must be made through a pull request|protected branch|push declined/.test(
      text
    )
  ) {
    return 'rules';
  }
  return /non-fast-forward|fetch first|updates were rejected/.test(text)
    ? 'race'
    : 'other';
}

export async function pushWithRetry({ push, rebase, maxAttempts = 3 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await push();
    if (result.code === 0) {
      return;
    }
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (classifyPushFailure(output) !== 'race' || attempt === maxAttempts) {
      throw new Error(`Git push failed: ${output.trim()}`);
    }
    await rebase();
  }
}
