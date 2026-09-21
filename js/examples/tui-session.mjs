// Drive a TUI with input that only becomes available later: the session stays
// open between an authorization URL being printed and the code being typed.
import assert from 'node:assert/strict';

import { openTerminal } from 'command-stream';

const login = String.raw`
process.stdin.setRawMode(true);
let typed = '';
process.stdin.on('data', (data) => {
  for (const character of data.toString()) {
    if (character === '\r') {
      process.stdout.write('\r\nLogged in with ' + typed + '\r\n');
      setTimeout(() => process.exit(0), 20);
    } else {
      typed += character;
    }
  }
});
process.stdout.write('Open https://example.test/device?code=ABCD-1234\r\n');
`;

const session = await openTerminal({
  file: process.execPath,
  args: ['-e', login],
  cols: 80,
  rows: 10,
});

// Same readiness semantics as `interactions`, including idleMilliseconds.
await session.waitFor(/Open (https:\/\/\S+)/, { idleMilliseconds: 50 });
const url = session.transcript.match(/Open (https:\/\/\S+)/)[1];
console.log(`authorize at ${url}`);

// A human opens the URL and comes back with a code; no timeout kills the child.
await new Promise((resolve) => setTimeout(resolve, 250));

await session.send({ text: 'ABCD-1234', key: 'ENTER' });
await session.waitFor('Logged in with ABCD-1234');

const capture = await session.close();
assert.equal(capture.exitCode, 0);
assert.match(capture.transcript, /Logged in with ABCD-1234/);
console.log(capture.transcript);
