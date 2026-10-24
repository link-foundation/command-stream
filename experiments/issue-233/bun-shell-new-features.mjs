const t = Date.now();
const p = Bun.spawn(['sleep', '5'], { timeout: 200 });
await p.exited;
console.log('Bun.spawn timeout', p.exitCode, p.signalCode, Date.now() - t);
console.log('$.timeout', typeof Bun.$`true`.timeout);
const d = Bun.spawn(['sleep', '0.1'], {
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
});
console.log('detached pid', d.pid);
d.unref();
