import { captureTerminal } from 'command-stream';

const program = `
const frames = [
  '\\u001b[2J\\u001b[H\\u001b[1;38;2;96;165;250mCommand Stream\\u001b[0m\\r\\n\\r\\n┌──────────┬──────────┐\\r\\n│ status   │ starting │\\r\\n└──────────┴──────────┘',
  '\\u001b[H\\u001b[1;38;2;96;165;250mCommand Stream\\u001b[0m\\r\\n\\r\\n┌──────────┬──────────┐\\r\\n│ status   │ \\u001b[33mrunning \\u001b[0m │\\r\\n└──────────┴──────────┘',
  '\\u001b[H\\u001b[1;38;2;96;165;250mCommand Stream\\u001b[0m\\r\\n\\r\\n┌──────────┬──────────┐\\r\\n│ status   │ \\u001b[1;32mcomplete\\u001b[0m │\\r\\n└──────────┴──────────┘',
];
for (const [index, frame] of frames.entries()) {
  process.stdout.write(frame);
  await new Promise((resolve) => setTimeout(resolve, index === 1 ? 350 : 180));
}
`;

const artifactDirectory = new URL(
  '../docs/screenshots/terminal-artifacts/',
  import.meta.url
).pathname;

await captureTerminal({
  file: process.execPath,
  args: ['--input-type=module', '--eval', program],
  cols: 24,
  rows: 7,
  settleMilliseconds: 25,
  artifactDirectory,
});

console.log(`Wrote terminal artifacts to ${artifactDirectory}`);
