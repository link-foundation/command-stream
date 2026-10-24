const start = Date.now();
const child = Bun.spawn(['sh', '-c', 'sleep 3 & echo done'], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  detached: true,
});
const iterator = child.stdout[Symbol.asyncIterator]();
let aborted = false;
let abortResolve;
const abortP = new Promise((r) => (abortResolve = r));
setTimeout(() => {
  aborted = true;
  abortResolve({ aborted: true });
  console.log('aborting at', Date.now() - start);
}, 150);
(async () => {
  try {
    while (true) {
      const res = await Promise.race([iterator.next(), abortP]);
      if (res.aborted) {
        console.log('abort detected at', Date.now() - start);
        break;
      }
      if (res.done) {
        console.log('done at', Date.now() - start);
        break;
      }
      console.log(
        'chunk at',
        Date.now() - start,
        new TextDecoder().decode(res.value).trim()
      );
    }
  } finally {
    if (iterator.return) {
      await iterator
        .return()
        .catch((e) => console.log('return err', e.message));
      console.log('iterator.return done at', Date.now() - start);
    }
  }
  console.log('LOOP EXITED at', Date.now() - start);
})();
setTimeout(() => {
  console.log('--- 4s, exit');
  process.exit(0);
}, 4000);
