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

const initialDimensions = `${process.stdout.columns}x${process.stdout.rows}`;
const resizeWatcher = setInterval(() => {
  const dimensions = `${process.stdout.columns}x${process.stdout.rows}`;
  if (dimensions !== initialDimensions) {
    clearInterval(resizeWatcher);
    render(`resized:${dimensions}`);
    setTimeout(() => process.exit(0), 20);
  }
}, 5);

render(
  `ready:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}`
);
for (let index = 0; index < 8; index += 1) {
  await pause(5);
  render(
    `ready:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}`
  );
}
