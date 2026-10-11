const start = Date.now();
const child = Bun.spawn(['sh', '-c', 'sleep 3 & echo done'], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  detached: true,
});
child.exited.then((code) =>
  console.log('child.exited resolved at', Date.now() - start, 'code', code)
);
// read stdout
const reader = child.stdout.getReader();
(async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('stdout EOF at', Date.now() - start);
      break;
    }
    console.log(
      'stdout data at',
      Date.now() - start,
      new TextDecoder().decode(value).trim()
    );
  }
})();
setTimeout(() => {
  console.log('--- 4s mark, exiting');
  process.exit(0);
}, 4000);
