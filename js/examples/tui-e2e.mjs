import assert from 'node:assert/strict';

import { captureTerminal } from 'command-stream';

const menu = String.raw`
process.stdin.setRawMode(true);
let selected = 0;
const choices = ['local', 'web_search'];
const draw = () => {
  process.stdout.write(
    '\x1b[2J\x1b[HChoose a tool\n' +
    choices.map((choice, index) => (index === selected ? '> ' : '  ') + choice).join('\n')
  );
};
process.stdin.on('data', (data) => {
  if (data.equals(Buffer.from('\x1b[B'))) {
    selected = Math.min(selected + 1, choices.length - 1);
    draw();
  } else if (data.equals(Buffer.from('\r'))) {
    process.stdout.write('\x1b[2J\x1b[Htool:' + choices[selected] + '\nresult:done');
    process.exit(0);
  }
});
draw();
`;

const capture = await captureTerminal({
  file: process.execPath,
  args: ['-e', menu],
  cols: 80,
  rows: 24,
  env: { ...process.env, TERM: 'xterm-256color' },
  interactions: [
    { after: /Choose a tool/, idleMilliseconds: 50, key: '\x1b[B' },
    { after: /> web_search/, idleMilliseconds: 50, key: 'ENTER' },
  ],
  artifactDirectory: 'artifacts/tui-e2e',
});

assert.match(capture.output, /tool:web_search/);
assert.match(capture.output, /result:done/);
console.log(capture.transcript);
