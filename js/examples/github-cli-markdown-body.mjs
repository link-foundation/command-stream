#!/usr/bin/env node
// Create one issue with a complex Markdown body (GitHub issue #40).
//
// Direct argument mode:
//   COMMAND_STREAM_EXAMPLE_REPOSITORY=owner/repository \
//     bun js/examples/github-cli-markdown-body.mjs
//
// GitHub CLI stdin mode:
//   COMMAND_STREAM_EXAMPLE_REPOSITORY=owner/repository \
//     bun js/examples/github-cli-markdown-body.mjs --body-file

import { $ } from '../src/$.mjs';

const repository = process.env.COMMAND_STREAM_EXAMPLE_REPOSITORY;
const useBodyFile = process.argv.includes('--body-file');
const title = 'command-stream complex Markdown example';
const body = `## Reproduction

\`\`\`javascript
const message = \`literal \${value}\`;
console.log("double", 'single', message);
\`\`\`

- shell-looking text stays literal: $HOME \${USER} $(whoami) \`date\`
- paths stay intact: C:\\Program Files\\command-stream\\
- Unicode stays intact: 雪 🚀 café`;

if (!repository) {
  console.error('Set COMMAND_STREAM_EXAMPLE_REPOSITORY=owner/repository.');
  process.exitCode = 1;
} else {
  const result = useBodyFile
    ? await $({
        mirror: false,
        stdin: body,
      })`gh issue create --repo ${repository} --title ${title} --body-file -`
    : await $({
        mirror: false,
      })`gh issue create --repo ${repository} --title ${title} --body ${body}`;

  console.log(result.stdout.trim());
}
