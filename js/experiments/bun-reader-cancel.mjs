const start = Date.now();
const child = Bun.spawn(['sh', '-c', 'sleep 3 & echo done'], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  detached: true,
});
const reader = child.stdout.getReader();
let cancelled = false;
setTimeout(async () => {
  cancelled = true;
  console.log('cancel at', Date.now() - start);
  await reader.cancel().catch((e) => console.log('cancel err', e.message));
  console.log('cancel resolved at', Date.now() - start);
}, 150);
(async () => {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        console.log('done at', Date.now() - start);
        break;
      }
      console.log(
        'chunk at',
        Date.now() - start,
        new TextDecoder().decode(value).trim()
      );
    }
  } catch (e) {
    console.log('read threw at', Date.now() - start, e.message);
  }
  console.log('LOOP EXITED at', Date.now() - start);
})();
setTimeout(() => {
  console.log('--- 4s, exit');
  process.exit(0);
}, 4000);
