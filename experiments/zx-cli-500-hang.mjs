// Does `zx <url>` exit when the server answers 500 and keeps the socket open?
import { spawn } from 'node:child_process';
import { fakeServer } from '../js/tests/zx/fixtures/server.mjs';

const server = await fakeServer([`HTTP/1.1 500\n\n500\n`]).start();
const started = Date.now();
const child = spawn(
  process.execPath,
  [process.env.ZX_CLI || 'js/src/zx/cli.mjs', server.url],
  { stdio: 'inherit' }
);
const timer = setTimeout(() => {
  console.log('still running after 3s');
  child.kill();
}, 3000);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  console.log('exit', code, signal, `${Date.now() - started}ms`);
  server.close();
  server.unref();
});
