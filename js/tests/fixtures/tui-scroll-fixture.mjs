const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

for (const line of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
  process.stdout.write(`${line}\r\n`);
  await pause(15);
}
