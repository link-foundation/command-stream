import cp from 'child_process';
const start = Date.now();
const child = cp.spawn('sh', ['-c', 'sleep 3 & echo done'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
});
child.on('exit', (code, sig) =>
  console.log('exit event at', Date.now() - start, 'code', code, 'sig', sig)
);
child.on('close', (code, sig) =>
  console.log('close event at', Date.now() - start, 'code', code)
);
child.stdout.on('data', (d) =>
  console.log('stdout data at', Date.now() - start, d.toString().trim())
);
child.stdout.on('end', () => console.log('stdout end at', Date.now() - start));
setTimeout(() => {
  console.log('--- 4s, exit');
  process.exit(0);
}, 4000);
