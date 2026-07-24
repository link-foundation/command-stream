const clear = '\u001b[2J\u001b[H';
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

process.stdin.setRawMode?.(true);
process.stdin.resume();

const render = (body) => {
  process.stdout.write(`${clear}${body}`);
};

let input = '';
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString()) {
    if (character === '\r') {
      render(`typed:${input}`);
      input = '';
    } else {
      input += character;
    }
  }
});

render(`ready:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}`);
for (let index = 0; index < 8; index += 1) {
  await pause(5);
  render(`ready:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}`);
}

process.on('SIGWINCH', () => {
  render(`resized:${process.stdout.columns}x${process.stdout.rows}`);
  setTimeout(() => process.exit(0), 20);
});
