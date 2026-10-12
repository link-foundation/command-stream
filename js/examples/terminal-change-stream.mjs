// Run with Node or Bun. Shows live changes while input stays available.
import { openTerminal } from '../src/$.mjs';
import { fileURLToPath } from 'node:url';

const program = `
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\\x1b[2J\\x1b[H\\x1b[1;36mVirtual terminal\\x1b[0m\\r\\nStatus: ready');
process.stdin.on('data', (data) => {
  if (data.toString().includes('n')) {
    process.stdout.write('\\x1b[2;1HStatus: \\x1b[33mrunning\\x1b[0m');
  }
  if (data.toString().includes('q')) {
    process.stdout.write('\\x1b[2;1HStatus: \\x1b[32mcomplete\\x1b[0m');
    setTimeout(() => process.exit(0), 50);
  }
});
`;
const session = await openTerminal({
  file: 'node',
  args: ['-e', program],
  cols: 24,
  rows: 4,
  frameMode: 'writes',
  timeoutMilliseconds: 5000,
  artifactDirectory: fileURLToPath(
    new URL('../docs/screenshots/terminal-changes/', import.meta.url)
  ),
});
const changes = [];
const unsubscribe = session.onChange((change) => {
  changes.push(change);
  console.log(
    `Change ${change.sequence}: rows ${change.updates.map((row) => row.y).join(',')}`
  );
});
try {
  await session.waitFor('ready', { idleMilliseconds: 30 });
  await session.send({ text: 'n' });
  await session.waitFor('running', { idleMilliseconds: 30 });
  await session.send({ text: 'q' });
  const capture = await session.finished();
  console.log(`Frames: ${capture.frames.length}; changes: ${changes.length}`);
  console.log(session.text());
} finally {
  unsubscribe();
  await session.dispose();
}
