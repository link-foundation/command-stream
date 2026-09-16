const clear = '\u001b[2J\u001b[H';
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

process.stdout.write(`${clear}first-state`);
await pause(20);
process.stdout.write('\u001b[2');
await pause(20);
process.stdout.write('J\u001b[Hsecond-state');
await pause(20);
